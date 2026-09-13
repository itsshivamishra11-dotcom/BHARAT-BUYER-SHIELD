import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

app.use(cors());
app.use(express.json());
app.use((req, _res, next) => {
  console.log(
    `📡 REQUEST: ${req.method} ${req.url}`
  );
  next();
});

const PORT = 5000;

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error("❌ GEMINI_API_KEY is missing in .env");
  process.exit(1);
}

const ai = new GoogleGenAI({
  apiKey,
});

/* -------------------------------------------------------------------------- */
/* GOOGLE PLACES LOCATION VERIFICATION                                       */
/* -------------------------------------------------------------------------- */

const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;

type PlaceCandidate = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  businessStatus?: string;
  googleMapsUri?: string;
  location?: {
    latitude?: number;
    longitude?: number;
  };
};

function normalizeText(value: string = ""): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string = ""): string[] {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length >= 3);
}

function similarityScore(a: string, b: string): number {
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));

  if (!aTokens.size || !bTokens.size) return 0;

  let common = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) common++;
  }

  return Math.round((2 * common / (aTokens.size + bTokens.size)) * 100);
}

async function verifySellerLocation(
  sellerName: string,
  sellerLocation: string
) {
  const baseResult = {
    verificationScore: 0,
    sellerNameProvided: sellerName || "Not available",
    locationProvided: sellerLocation || "Not available",
    matchedPlaceName: "Not available",
    matchedAddress: "Not available",
    businessStatus: "Not available",
    googleMapsUrl: "Not available",
    nameMatchScore: 0,
    locationMatchScore: 0,
  };

  // No API key: Places verification could not be performed.
  if (!googleMapsApiKey) {
    console.warn("⚠️ GOOGLE_MAPS_API_KEY is missing. Skipping Places verification.");
    return {
      ...baseResult,
      status: "UNABLE TO VERIFY",
      message: "Google Places verification is unavailable because the API key is missing.",
    };
  }

  // Missing seller/location is NOT the same as "not verified".
  // We simply cannot perform an independent Maps check.
  if (
    !sellerName ||
    sellerName.trim().toLowerCase() === "not available" ||
    !sellerLocation ||
    sellerLocation.trim().toLowerCase() === "not available"
  ) {
    return {
      ...baseResult,
      status: "UNABLE TO VERIFY",
      message:
        "Seller name and/or seller location was not available in the submitted product information. Google Maps verification could not be performed.",
    };
  }

  const textQuery = `${sellerName}, ${sellerLocation}`;

  try {
    const response = await fetch(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": googleMapsApiKey,
          "X-Goog-FieldMask":
            "places.id,places.displayName,places.formattedAddress,places.businessStatus,places.googleMapsUri,places.location",
        },
        body: JSON.stringify({
          textQuery,
          languageCode: "en",
          regionCode: "IN",
          maxResultCount: 5,
        }),
      }
    );

    const body = await response.json();

    if (!response.ok) {
      console.error("❌ Google Places error:", body);

      return {
        ...notAvailable,
        message:
          "Google Places could not verify this seller location at the moment.",
      };
    }

    const places: PlaceCandidate[] = Array.isArray(body?.places)
      ? body.places
      : [];

    if (!places.length) {
      return {
        ...notAvailable,
        status: "NOT FOUND",
        message:
          "No matching business/place was found in Google Places for the supplied seller and location.",
      };
    }

    const candidates = places.map((place) => {
      const placeName = place.displayName?.text || "";
      const placeAddress = place.formattedAddress || "";

      const nameMatchScore = similarityScore(sellerName, placeName);
      const locationMatchScore = similarityScore(
        sellerLocation,
        placeAddress
      );

      // Location is weighted more heavily because the goal is to verify
      // whether the seller's stated shop location exists at that address.
      const verificationScore = Math.round(
        nameMatchScore * 0.45 + locationMatchScore * 0.55
      );

      return {
        place,
        placeName,
        placeAddress,
        nameMatchScore,
        locationMatchScore,
        verificationScore,
      };
    });

    candidates.sort(
      (a, b) => b.verificationScore - a.verificationScore
    );

    const best = candidates[0];

    let status = "NOT VERIFIED";

    if (
      best.verificationScore >= 75 &&
      best.nameMatchScore >= 60 &&
      best.locationMatchScore >= 60
    ) {
      status = "VERIFIED";
    } else if (
      best.verificationScore >= 45 &&
      (best.nameMatchScore >= 45 || best.locationMatchScore >= 55)
    ) {
      status = "PARTIAL MATCH";
    }

    return {
      status,
      verificationScore: best.verificationScore,
      sellerNameProvided: sellerName,
      locationProvided: sellerLocation,
      matchedPlaceName: best.placeName || "Not available",
      matchedAddress: best.placeAddress || "Not available",
      businessStatus: best.place.businessStatus || "Not available",
      googleMapsUrl:
        best.place.googleMapsUri ||
        (best.place.id
          ? `https://www.google.com/maps/search/?api=1&query=Google&query_place_id=${encodeURIComponent(
              best.place.id
            )}`
          : "Not available"),
      nameMatchScore: best.nameMatchScore,
      locationMatchScore: best.locationMatchScore,
      message:
        status === "VERIFIED"
          ? "Seller name and stated shop location closely match a Google Places listing."
          : status === "PARTIAL MATCH"
          ? "A possible Google Places match was found, but the seller/location match is not strong enough for full verification."
          : "A Google Places result was found, but the seller/location details do not match strongly enough.",
    };
  } catch (error) {
    console.error("❌ Google Places verification failed:", error);

    return {
      ...notAvailable,
      message:
        "Google Places verification failed. The main product analysis can still continue.",
    };
  }
}

/* -------------------------------------------------------------------------- */
/* RESPONSE SCHEMA                                                            */
/* -------------------------------------------------------------------------- */

const analysisSchema = {
  type: "object",

  properties: {
    product: {
      type: "object",
      properties: {
        name: { type: "string" },
        category: { type: "string" },
        price: { type: "string" },
        description: { type: "string" },
      },
      required: [
        "name",
        "category",
        "price",
        "description",
      ],
    },

    seller: {
      type: "object",
      properties: {
        name: { type: "string" },
        location: { type: "string" },
        trustNotes: { type: "string" },
      },
      required: [
        "name",
        "location",
        "trustNotes",
      ],
    },

    productDetails: {
      type: "object",
      properties: {
        manufacturingLocation: { type: "string" },
        sellingLocation: { type: "string" },
        warranty: { type: "string" },
        returnPolicy: { type: "string" },
      },
      required: [
        "manufacturingLocation",
        "sellingLocation",
        "warranty",
        "returnPolicy",
      ],
    },

    claims: {
      type: "array",
      items: {
        type: "object",
        properties: {
          claim: { type: "string" },
          status: { type: "string" },
          explanation: { type: "string" },
        },
        required: [
          "claim",
          "status",
          "explanation",
        ],
      },
    },

    evidence: {
      type: "array",
      items: {
        type: "object",
        properties: {
          source: { type: "string" },
          finding: { type: "string" },
          reliability: { type: "string" },
        },
        required: [
          "source",
          "finding",
          "reliability",
        ],
      },
    },

    contradictions: {
      type: "array",
      items: {
        type: "string",
      },
    },

    riskFactors: {
      type: "array",
      items: {
        type: "string",
      },
    },

    riskScore: {
      type: "number",
    },

    confidenceScore: {
      type: "number",
    },

    decision: {
      type: "string",
      enum: ["BUY", "VERIFY FIRST", "AVOID"],
    },

    decisionSummary: {
      type: "string",
    },

    bestBuyingAdvice: {
      type: "string",
    },

    bestPrice: {
      type: "string",
    },

    trustedWebsite: {
      type: "string",
    },

    alternativeProductUrl: {
      type: "string",
    },

    estimatedSavings: {
      type: "string",
    },

    sellerLocationVerification: {
      type: "object",
      properties: {
        status: { type: "string" },
        verificationScore: { type: "number" },
        sellerNameProvided: { type: "string" },
        locationProvided: { type: "string" },
        matchedPlaceName: { type: "string" },
        matchedAddress: { type: "string" },
        businessStatus: { type: "string" },
        googleMapsUrl: { type: "string" },
        nameMatchScore: { type: "number" },
        locationMatchScore: { type: "number" },
        message: { type: "string" },
      },
      required: [
        "status",
        "verificationScore",
        "sellerNameProvided",
        "locationProvided",
        "matchedPlaceName",
        "matchedAddress",
        "businessStatus",
        "googleMapsUrl",
        "nameMatchScore",
        "locationMatchScore",
        "message",
      ],
    },
  },

  required: [
    "product",
    "seller",
    "productDetails",
    "claims",
    "evidence",
    "contradictions",
    "riskFactors",
    "riskScore",
    "confidenceScore",
    "decision",
    "decisionSummary",
    "bestBuyingAdvice",
    "bestPrice",
    "trustedWebsite",
    "alternativeProductUrl",
    "estimatedSavings",
    "sellerLocationVerification",
  ],
};

/* -------------------------------------------------------------------------- */
/* HEALTH CHECK                                                               */
/* -------------------------------------------------------------------------- */

app.get("/", (_req, res) => {
  res.json({
    message: "Bharat Buyer Shield API is running 🛡️",
  });
});

app.get("/api/maps-status", (_req, res) => {
  res.json({
    googlePlacesConfigured: Boolean(googleMapsApiKey),
    message: googleMapsApiKey
      ? "Google Places API key is configured."
      : "GOOGLE_MAPS_API_KEY is missing from server/.env.",
  });
});

/* -------------------------------------------------------------------------- */
/* PRODUCT ANALYSIS                                                           */
/* -------------------------------------------------------------------------- */

app.post(
  "/api/analyze",
  upload.single("screenshot"),
  async (req, res) => {
    try {
      const url = req.body?.url || "";
      const screenshot = req.file;
      if (!url && !screenshot) {
        return res.status(400).json({
          error:
            "Please provide a product URL or upload a screenshot.",
        });
      }

      if (url) {
        try {
          new URL(url);
        } catch {
          return res.status(400).json({
            error: "Please provide a valid product URL.",
          });
        }
      }

      console.log(
        `🔍 Analysis started | URL: ${
          url || "None"
        } | Screenshot: ${
          screenshot ? "Yes" : "No"
        }`
      );

      const prompt = `
You are the core AI analyst for Bharat Buyer Shield,
an Indian online shopping safety and buyer decision system.

Your goal is to help a buyer decide whether a product listing
appears safe, requires verification, or should be avoided.

Analyze the supplied product URL and/or screenshot.

==================================================
PRODUCT UNDERSTANDING
==================================================

Extract, when available:

1. Product name
2. Product category/type
3. Current price
4. Visible discount
5. Seller name
6. Seller/shop location
7. Manufacturing location
8. Product specifications
9. Warranty
10. Return/refund policy
11. Product claims
12. Review signals
13. Pricing signals
14. Missing information

==================================================
CLAIM ANALYSIS
==================================================

Look for claims such as:

- ISI certified
- BIS certified
- Original
- 70% OFF
- 1 Year Warranty
- Made in India
- Premium quality
- Genuine product
- Brand authorised
- Free return

Do not declare a claim false unless reliable evidence supports that conclusion.

==================================================
BEHAVIOUR ANALYSIS
==================================================

Look for:

- suspicious pricing
- unusually large discounts
- missing seller information
- weak return protection
- inconsistent product information
- suspicious review signals
- unsupported warranty claims
- unsupported certification claims
- other meaningful buyer risks

==================================================
CONTRADICTION ENGINE
==================================================

Look for contradictions between:

Listing ↔ Specifications
Listing ↔ Policy
Listing ↔ Reviews
Listing ↔ Product Claims
Price ↔ Discount Claims
Seller Information ↔ Available Evidence

If no contradiction is found, say:

"No major contradiction detected."

==================================================
RISK ENGINE
==================================================

Generate:

Risk Score:
0 = very low apparent risk
100 = very high apparent risk

Confidence Score:
0 = almost no reliable evidence
100 = strong and sufficient evidence

Decision MUST be exactly one of:

BUY
VERIFY FIRST
AVOID

Important:

- BUY means available evidence indicates relatively low apparent risk.
- VERIFY FIRST means important information is missing or uncertain.
- AVOID means strong warning signs indicate the purchase may be unsafe.

==================================================
SCREENSHOT FALLBACK
==================================================

If a screenshot is provided:

Carefully inspect the visible image.

Extract visible:

- product name
- price
- discount
- seller
- specifications
- ratings
- reviews
- warranty
- return policy
- certification claims
- location information
- other important listing information

Do not invent information that is not visible.

If text is unreadable, say "Not available".

==================================================
RESTRICTED WEBSITE HANDLING
==================================================

If a website blocks access:

Do NOT guess the missing information.

Return:

"Not available due to restricted access to live page content."

Reduce the confidence score accordingly.

==================================================
BEST PRICE + TRUSTED WEBSITE
==================================================

Use current web information when possible to find:

1. Better available price
2. Trusted website
3. Same or equivalent product
4. Estimated savings

Only return an alternative if there is evidence for it.

DO NOT INVENT:

- prices
- websites
- product URLs
- savings

If no verified alternative is found, return:

bestPrice = "Not available"
trustedWebsite = "Not available"
alternativeProductUrl = "Not available"
estimatedSavings = "Not available"

==================================================
EVIDENCE
==================================================

Provide evidence supporting the assessment.

For each evidence item provide:

- source
- finding
- reliability

Clearly distinguish facts from AI assessment.

==================================================
IMPORTANT SAFETY RULES
==================================================

Never invent facts.

Never accuse a seller of fraud without evidence.

If information is unavailable, say "Not available".

This is an AI-assisted buyer-safety prototype,
not a legal or financial guarantee.

Finally provide practical advice explaining
what the buyer should do before spending money.

==================================================
SELLER LOCATION EXTRACTION
==================================================

For seller location verification, make the seller fields as precise as possible:

- seller.name should contain the actual seller/shop/business name.
- seller.location should contain the visible shop/business address or location.
- Do not put general marketplace names such as Amazon or Flipkart into seller.name
  unless that marketplace is actually the seller shown in the listing.
- If only a city/state is visible, return exactly what is visible.
- Never invent an address.
`;

      /* -------------------------------------------------------------------- */
      /* GEMINI CONTENT                                                       */
      /* -------------------------------------------------------------------- */

      const parts: any[] = [
        {
          text: `
${prompt}

Submitted product URL:

${url || "No product URL provided."}

A screenshot may also be attached.
`,
        },
      ];

      /* -------------------------------------------------------------------- */
      /* SCREENSHOT INPUT                                                     */
      /* -------------------------------------------------------------------- */

      if (screenshot) {
        parts.push({
          inlineData: {
            mimeType: screenshot.mimetype,
            data: screenshot.buffer.toString("base64"),
          },
        });
      }

      /* -------------------------------------------------------------------- */
      /* GEMINI REQUEST                                                       */
      /* -------------------------------------------------------------------- */

      let response: Awaited<
        ReturnType<typeof ai.models.generateContent>
      > | null = null;

      const maxAttempts = 3;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          console.log(
            `🤖 Gemini attempt ${attempt}/${maxAttempts}`
          );

          response = await ai.models.generateContent({
            model: "gemini-3.5-flash-lite",

            contents: [
              {
                role: "user",
                parts,
              },
            ],

            config: {
          // URL Context works on the Free Tier. Google Search grounding
          // is intentionally omitted here because Gemini 3 Search grounding
          // is not available on the Free Tier.
          tools: [
            {
              urlContext: {},
            },
          ],

          // Current @google/genai JavaScript SDK structured-output config
              responseMimeType: "application/json",
              responseSchema: analysisSchema,
            },
          });

          break;
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : String(error);

          const is429 =
            message.includes("429") ||
            message.includes("RESOURCE_EXHAUSTED") ||
            message.toLowerCase().includes("quota");

          console.error(
            `❌ Gemini attempt ${attempt} failed:`,
            message
          );

          if (!is429 || attempt === maxAttempts) {
            throw error;
          }

          const delayMs = attempt * 6000;

          console.log(
            `⏳ Rate limit detected. Waiting ${delayMs / 1000}s before retry...`
          );

          await new Promise((resolve) =>
            setTimeout(resolve, delayMs)
          );
        }
      }

      if (!response) {
        throw new Error(
          "Gemini did not return a response after retries."
        );
      }

      const text = response.text;

      if (!text) {
        throw new Error(
          "Gemini returned an empty response."
        );
      }

      const result = JSON.parse(text);

      console.log("📍 Verifying seller location with Google Places...");

      const sellerLocationVerification = await verifySellerLocation(
        result?.seller?.name || "",
        result?.seller?.location || ""
      );

      result.sellerLocationVerification = sellerLocationVerification;

      // Only treat an actual failed/missing Places match as a risk signal.
      // "UNABLE TO VERIFY" means there was not enough seller/location data
      // to perform the check, so we do not penalize the product automatically.
      if (
        sellerLocationVerification.status === "NOT FOUND" ||
        sellerLocationVerification.status === "NOT VERIFIED"
      ) {
        if (!Array.isArray(result.riskFactors)) {
          result.riskFactors = [];
        }

        result.riskFactors.push(
          "Seller shop location could not be independently verified through Google Places."
        );

        if (
          typeof result.riskScore === "number" &&
          result.riskScore < 100
        ) {
          result.riskScore = Math.min(100, result.riskScore + 5);
        }
      }

      console.log(
        `📍 Seller location verification: ${sellerLocationVerification.status} (${sellerLocationVerification.verificationScore}/100)`
      );

      console.log("✅ Analysis completed");

      return res.json({
        success: true,

        sourceUrl: url || null,

        hasScreenshot: Boolean(screenshot),

        analysis: result,
      });
    } catch (error) {
      console.error(
        "❌ Analysis error:",
        error
      );

      const errorMessage =
        error instanceof Error
          ? error.message
          : String(error);

      const isQuotaError =
        errorMessage.includes("429") ||
        errorMessage.includes("RESOURCE_EXHAUSTED") ||
        errorMessage.toLowerCase().includes("quota");

      return res.status(isQuotaError ? 429 : 500).json({
        success: false,

        error: isQuotaError
          ? "Gemini API rate limit/quota reached. Please wait a moment and try again."
          : "Unable to analyze this product right now.",

        details: errorMessage,
      });
    }
  }
);

/* -------------------------------------------------------------------------- */
/* START SERVER                                                               */
/* -------------------------------------------------------------------------- */

app.listen(PORT, () => {
  console.log(
    `🛡️ Bharat Buyer Shield API running on http://localhost:${PORT}`
  );
});