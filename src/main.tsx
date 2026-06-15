import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { isNativeMobileApp } from "@/lib/platform";
import "./index.css";

if (isNativeMobileApp()) {
  document.documentElement.classList.add("native-mobile-app");
}

createRoot(document.getElementById("root")!).render(<App />);
