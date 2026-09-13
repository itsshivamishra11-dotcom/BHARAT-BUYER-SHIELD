import { defineConfig, type Plugin } from "vite"
import react from "@vitejs/plugin-react"

const deploymentApiUrl = "https://bharat-buyer-shield.onrender.com/api/analyze"

const productionApiPlugin = (): Plugin => ({
  name: "bharat-buyer-shield-production-api",
  transform(code, id) {
    if (id.endsWith("/src/App.tsx")) {
      return code.replaceAll("http://localhost:5000/api/analyze", deploymentApiUrl)
    }
    return null
  },
})

export default defineConfig({
  plugins: [react(), productionApiPlugin()],
})
