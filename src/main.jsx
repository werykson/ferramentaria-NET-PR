import React, { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { initTelemetry } from "./telemetry.js";

initTelemetry();

const root = ReactDOM.createRoot(document.getElementById("root"));
const anonConfigured = Boolean(
  String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? "").trim()
);

function MissingSupabaseEnv() {
  return (
    <div
      style={{
        minHeight: "100vh",
        padding: 32,
        fontFamily: "system-ui, sans-serif",
        background: "#f8fafc",
        color: "#0f172a",
        boxSizing: "border-box",
      }}
    >
      <h1 style={{ fontSize: "1.35rem", marginBottom: 12 }}>
        Configuração do servidor incompleta
      </h1>
      <p style={{ maxWidth: 560, lineHeight: 1.6 }}>
        O site está publicado, mas faltam variáveis no painel da{" "}
        <strong>Vercel</strong>. Adicione em{" "}
        <strong>Settings → Environment Variables</strong> (ambiente{" "}
        <strong>Production</strong>):
      </p>
      <ul style={{ maxWidth: 560, lineHeight: 1.7, marginTop: 12 }}>
        <li>
          <code style={{ background: "#e2e8f0", padding: "2px 6px", borderRadius: 4 }}>
            VITE_SUPABASE_ANON_KEY
          </code>{" "}
          — chave <strong>Publishable</strong> do Supabase (Settings → API Keys).
        </li>
        <li>
          Opcional:{" "}
          <code style={{ background: "#e2e8f0", padding: "2px 6px", borderRadius: 4 }}>
            VITE_SUPABASE_URL
          </code>{" "}
          — URL do projeto (Settings → Data API).
        </li>
      </ul>
      <p style={{ marginTop: 16 }}>
        Depois salve e faça um <strong>Redeploy</strong> do último deployment (Deployments → ⋮ →
        Redeploy).
      </p>
      <p style={{ marginTop: 12, fontSize: 14, color: "#64748b" }}>
        Em desenvolvimento local, use o arquivo <code>.env.local</code> na raiz do projeto (veja{" "}
        <code>.env.example</code>).
      </p>
    </div>
  );
}

if (!anonConfigured) {
  root.render(<MissingSupabaseEnv />);
} else {
  import("./App.jsx").then(({ default: App }) => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>
    );
  });
}
