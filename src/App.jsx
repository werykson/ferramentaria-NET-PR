import { useEffect, useMemo, useState } from "react";

const CCS = [
  "CC NET APOIO PR",
  "CC NET CTA PR",
  "CC NET LDA PR",
  "CC NET MGA PR",
  "CC NET LITORAL PR",
  "CC NET SUDOESTE PR",
];

const MENU = [
  { key: "dashboard", label: "Dashboard" },
  { key: "itens", label: "Itens" },
  { key: "tecnicos", label: "Técnicos" },
  { key: "movimentacoes", label: "Movimentações" },
  { key: "estoque", label: "Estoque" },
  { key: "usuarios", label: "Usuários" },
];

const emptyMinimos = () => Object.fromEntries(CCS.map((cc) => [cc, ""]));
const STORAGE_KEY_ITEMS = "ferramentaria_net_pr_itens";
const STORAGE_KEY_AUTH = "ferramentaria_net_pr_auth";

export default function App() {
  const [logado, setLogado] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_AUTH) === "true";
    } catch {
      return false;
    }
  });

  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [pagina, setPagina] = useState("dashboard");

  const [itens, setItens] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_ITEMS);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [itemForm, setItemForm] = useState({
    codigo: "",
    nome: "",
    valor: "",
    qtdKit: "",
    minimos: emptyMinimos(),
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_ITEMS, JSON.stringify(itens));
  }, [itens]);

  const login = () => {
    if (usuario === "admin" && senha === "admin123") {
      setLogado(true);
      localStorage.setItem(STORAGE_KEY_AUTH, "true");
    } else {
      alert("Login inválido");
    }
  };

  const sair = () => {
    setLogado(false);
    setUsuario("");
    setSenha("");
    setPagina("dashboard");
    localStorage.removeItem(STORAGE_KEY_AUTH);
  };

  const atualizarMinimo = (cc, valor) => {
    setItemForm((prev) => ({
      ...prev,
      minimos: {
        ...prev.minimos,
        [cc]: valor,
      },
    }));
  };

  const cadastrarItem = () => {
    if (!itemForm.codigo.trim() || !itemForm.nome.trim()) {
      alert("Preencha o código e o nome do item.");
      return;
    }

    const novoItem = {
      id: Date.now(),
      codigo: itemForm.codigo.trim(),
      nome: itemForm.nome.trim(),
      valor: Number(itemForm.valor || 0),
      qtdKit: Number(itemForm.qtdKit || 0),
      minimos: Object.fromEntries(
        CCS.map((cc) => [cc, Number(itemForm.minimos[cc] || 0)])
      ),
    };

    setItens((prev) => [...prev, novoItem]);
    setItemForm({
      codigo: "",
      nome: "",
      valor: "",
      qtdKit: "",
      minimos: emptyMinimos(),
    });
  };

  const excluirItem = (id) => {
    setItens((prev) => prev.filter((item) => item.id !== id));
  };

  const exportarCSV = () => {
    if (itens.length === 0) {
      alert("Nenhum item para exportar");
      return;
    }

    const headers = ["codigo", "nome", "valor", "qtdKit", "minimos"];

    const rows = itens.map((item) => [
      item.codigo,
      item.nome,
      item.valor,
      item.qtdKit,
      JSON.stringify(item.minimos || {}),
    ]);

    const csvContent = [headers, ...rows]
      .map((linha) => linha.join(";"))
      .join("\n");

    const blob = new Blob([csvContent], {
      type: "text/csv;charset=utf-8;",
    });

const baixarModeloCSV = () => {
  const headers = [
    "codigo",
    "nome",
    "valor",
    "qtdKit",
    "CC NET APOIO PR",
    "CC NET CTA PR",
    "CC NET LDA PR",
    "CC NET MGA PR",
    "CC NET LITORAL PR",
    "CC NET SUDOESTE PR",
  ];

  const exemplo = [
    "001",
    "Alicate Universal",
    "45.90",
    "1",
    "2",
    "3",
    "2",
    "4",
    "1",
    "2",
  ];

  const csvContent = [headers, exemplo]
    .map((linha) => linha.join(";"))
    .join("\n");

  const blob = new Blob([csvContent], {
    type: "text/csv;charset=utf-8;",
  });

  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "modelo_itens.csv";
  link.click();
};

const importarCSV = (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();

  reader.onload = (e) => {
    const texto = e.target?.result;
    if (!texto) return;

    const linhas = String(texto)
      .split(/\r?\n/)
      .filter((linha) => linha.trim() !== "");

    if (linhas.length < 2) {
      alert("Arquivo CSV vazio ou inválido.");
      return;
    }

    const headers = linhas[0].split(";").map((h) => h.trim());

    const novosItens = linhas.slice(1).map((linha) => {
      const colunas = linha.split(";");

      const registro = {};
      headers.forEach((header, index) => {
        registro[header] = (colunas[index] || "").trim();
      });

      return {
        id: Date.now() + Math.random(),
        codigo: registro["codigo"] || "",
        nome: registro["nome"] || "",
        valor: Number(registro["valor"] || 0),
        qtdKit: Number(registro["qtdKit"] || 0),
        minimos: {
          "CC NET APOIO PR": Number(registro["CC NET APOIO PR"] || 0),
          "CC NET CTA PR": Number(registro["CC NET CTA PR"] || 0),
          "CC NET LDA PR": Number(registro["CC NET LDA PR"] || 0),
          "CC NET MGA PR": Number(registro["CC NET MGA PR"] || 0),
          "CC NET LITORAL PR": Number(registro["CC NET LITORAL PR"] || 0),
          "CC NET SUDOESTE PR": Number(registro["CC NET SUDOESTE PR"] || 0),
        },
      };
    });

    const itensValidos = novosItens.filter(
      (item) => item.codigo.trim() && item.nome.trim()
    );

    setItens((prev) => [...prev, ...itensValidos]);
    alert(`${itensValidos.length} item(ns) importado(s) com sucesso.`);
    event.target.value = "";
  };

  reader.readAsText(file, "utf-8");
};
    
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "itens.csv";
    link.click();
  };

  const totalItens = itens.length;
  const totalTecnicos = 0;

  const kitsHoje = useMemo(() => {
    const itensComKit = itens.filter((item) => item.qtdKit > 0);
    if (!itensComKit.length) return 0;
    return 0;
  }, [itens]);

  if (!logado) {
    return (
      <div style={styles.loginBg}>
        <div style={styles.loginCard}>
          <h1 style={styles.loginTitle}>Login do Sistema</h1>

          <label style={styles.label}>Usuário</label>
          <input
            style={styles.input}
            placeholder="Digite seu usuário"
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
          />

          <label style={styles.label}>Senha</label>
          <input
            style={styles.input}
            type="password"
            placeholder="Digite sua senha"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
          />

          <button style={styles.primaryButton} onClick={login}>
            Entrar
          </button>

          <p style={styles.loginHint}>Login inicial: admin / admin123</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.appShell}>
      <aside style={styles.sidebar}>
        <div style={styles.sidebarHeader}>Ferramentaria NET PR</div>

        <nav style={styles.menu}>
          {MENU.map((item) => (
            <button
              key={item.key}
              onClick={() => setPagina(item.key)}
              style={{
                ...styles.menuButton,
                ...(pagina === item.key ? styles.menuButtonActive : {}),
              }}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      <main style={styles.main}>
        <header style={styles.topbar}>
          <div>
            <h2 style={styles.pageTitle}>
              {MENU.find((m) => m.key === pagina)?.label || "Sistema"}
            </h2>
            <div style={styles.topbarSub}>Administrador</div>
          </div>

          <button style={styles.logoutButton} onClick={sair}>
            Sair
          </button>
        </header>

        {pagina === "dashboard" && (
          <>
            <div style={styles.cardsGrid}>
              <MetricCard titulo="Itens cadastrados" valor={totalItens} />
              <MetricCard titulo="Técnicos cadastrados" valor={totalTecnicos} />
              <MetricCard titulo="Kits completos hoje" valor={kitsHoje} />
            </div>

            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>Visão geral</h3>
              <p style={styles.mutedText}>
                Base do sistema pronta. Agora os itens já podem ter estoque
                mínimo separado por centro de custo e ficam salvos no navegador.
              </p>
            </div>
          </>
        )}

        {pagina === "itens" && (
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Cadastro de itens</h3>

            <div style={styles.formGrid}>
              <input
                style={styles.input}
                placeholder="Código do item"
                value={itemForm.codigo}
                onChange={(e) =>
                  setItemForm({ ...itemForm, codigo: e.target.value })
                }
              />

              <input
                style={styles.input}
                placeholder="Nome do item"
                value={itemForm.nome}
                onChange={(e) =>
                  setItemForm({ ...itemForm, nome: e.target.value })
                }
              />

              <input
                style={styles.input}
                type="number"
                placeholder="Valor unitário"
                value={itemForm.valor}
                onChange={(e) =>
                  setItemForm({ ...itemForm, valor: e.target.value })
                }
              />

              <input
                style={styles.input}
                type="number"
                placeholder="Qtd por kit"
                value={itemForm.qtdKit}
                onChange={(e) =>
                  setItemForm({ ...itemForm, qtdKit: e.target.value })
                }
              />
            </div>

            <div style={styles.sectionMini}>
              <h4 style={styles.sectionMiniTitle}>Estoque mínimo por CC</h4>
              <div style={styles.formGrid}>
                {CCS.map((cc) => (
                  <input
                    key={cc}
                    style={styles.input}
                    type="number"
                    placeholder={`${cc} - mínimo`}
                    value={itemForm.minimos[cc]}
                    onChange={(e) => atualizarMinimo(cc, e.target.value)}
                  />
                ))}
              </div>
            </div>

        <div style={styles.actionRow}>
  <button style={styles.primaryButtonInline} onClick={cadastrarItem}>
    Cadastrar item
  </button>

  <button style={styles.primaryButtonInline} onClick={exportarCSV}>
    Exportar CSV
  </button>

  <button style={styles.primaryButtonInline} onClick={baixarModeloCSV}>
    Baixar modelo CSV
  </button>

  <label style={styles.primaryButtonInline}>
    Importar CSV
    <input
      type="file"
      accept=".csv"
      onChange={importarCSV}
      style={{ display: "none" }}
    />
  </label>

  <button
    style={styles.secondaryButtonInline}
    onClick={() => {
      if (window.confirm("Deseja apagar todos os itens salvos no navegador?")) {
        setItens([]);
        localStorage.removeItem(STORAGE_KEY_ITEMS);
      }
    }}
  >
    Limpar itens salvos
  </button>
</div>
            
            <div style={styles.tableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Código</th>
                    <th style={styles.th}>Nome</th>
                    <th style={styles.th}>Valor</th>
                    <th style={styles.th}>Qtd/Kit</th>
                    <th style={styles.th}>Mínimos por CC</th>
                    <th style={styles.th}>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {itens.length === 0 ? (
                    <tr>
                      <td style={styles.td} colSpan={6}>
                        Nenhum item cadastrado.
                      </td>
                    </tr>
                  ) : (
                    itens.map((item) => (
                      <tr key={item.id}>
                        <td style={styles.td}>{item.codigo}</td>
                        <td style={styles.td}>{item.nome}</td>
                        <td style={styles.td}>R$ {item.valor.toFixed(2)}</td>
                        <td style={styles.td}>{item.qtdKit}</td>
                        <td style={styles.td}>
                          <div style={styles.minimosLista}>
                            {CCS.map((cc) => (
                              <div key={cc} style={styles.minimoLinha}>
                                <strong>{cc}:</strong> {item.minimos[cc] || 0}
                              </div>
                            ))}
                          </div>
                        </td>
                        <td style={styles.td}>
                          <button
                            style={styles.deleteButton}
                            onClick={() => excluirItem(item.id)}
                          >
                            Excluir
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {pagina === "tecnicos" && (
          <Placeholder
            titulo="Técnicos"
            texto="Aqui vamos cadastrar os técnicos por centro de custo."
          />
        )}

        {pagina === "movimentacoes" && (
          <Placeholder
            titulo="Movimentações"
            texto="Aqui vamos registrar entradas, saídas, reposições e histórico."
          />
        )}

        {pagina === "estoque" && (
          <Placeholder
            titulo="Estoque"
            texto="Aqui vamos mostrar saldo atual, kits possíveis e estoque por CC."
          />
        )}

        {pagina === "usuarios" && (
          <Placeholder
            titulo="Usuários"
            texto="Aqui vamos criar os acessos por cargo, login, senha e centro de custo."
          />
        )}
      </main>
    </div>
  );
}

function MetricCard({ titulo, valor }) {
  return (
    <div style={styles.card}>
      <div style={styles.cardTitle}>{titulo}</div>
      <div style={styles.cardValue}>{valor}</div>
    </div>
  );
}

function Placeholder({ titulo, texto }) {
  return (
    <div style={styles.section}>
      <h3 style={styles.sectionTitle}>{titulo}</h3>
      <p style={styles.mutedText}>{texto}</p>
    </div>
  );
}

const styles = {
  loginBg: {
    minHeight: "100vh",
    background: "#f1f5f9",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    fontFamily: "Arial, sans-serif",
  },
  loginCard: {
    width: "100%",
    maxWidth: 430,
    background: "#ffffff",
    borderRadius: 20,
    padding: 28,
    boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
    boxSizing: "border-box",
  },
  loginTitle: {
    marginTop: 0,
    marginBottom: 24,
    color: "#0f172a",
    fontSize: 32,
  },
  label: {
    display: "block",
    marginBottom: 8,
    color: "#0f172a",
    fontWeight: 600,
  },
  input: {
    width: "100%",
    padding: 12,
    marginBottom: 16,
    borderRadius: 10,
    border: "1px solid #cbd5e1",
    boxSizing: "border-box",
    fontSize: 14,
  },
  primaryButton: {
    width: "100%",
    padding: 14,
    borderRadius: 10,
    border: 0,
    background: "#0f172a",
    color: "#ffffff",
    cursor: "pointer",
    fontSize: 15,
  },
  primaryButtonInline: {
    padding: "12px 18px",
    borderRadius: 10,
    border: 0,
    background: "#0f172a",
    color: "#ffffff",
    cursor: "pointer",
    fontSize: 14,
  },
  secondaryButtonInline: {
    padding: "12px 18px",
    borderRadius: 10,
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#0f172a",
    cursor: "pointer",
    fontSize: 14,
  },
  actionRow: {
    display: "flex",
    gap: 12,
    flexWrap: "wrap",
    alignItems: "center",
  },
  loginHint: {
    marginTop: 16,
    fontSize: 12,
    color: "#64748b",
  },
  appShell: {
    minHeight: "100vh",
    display: "flex",
    background: "#f8fafc",
    fontFamily: "Arial, sans-serif",
  },
  sidebar: {
    width: 260,
    background: "#0f172a",
    color: "#ffffff",
    padding: 24,
    boxSizing: "border-box",
  },
  sidebarHeader: {
    fontSize: 24,
    fontWeight: 700,
    marginBottom: 28,
    lineHeight: 1.2,
  },
  menu: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  menuButton: {
    background: "transparent",
    color: "#cbd5e1",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 10,
    padding: 12,
    textAlign: "left",
    cursor: "pointer",
    fontSize: 14,
  },
  menuButtonActive: {
    background: "#1e293b",
    color: "#ffffff",
  },
  main: {
    flex: 1,
    padding: 28,
    boxSizing: "border-box",
  },
  topbar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
    gap: 16,
  },
  pageTitle: {
    margin: 0,
    color: "#0f172a",
  },
  topbarSub: {
    color: "#64748b",
    fontSize: 14,
    marginTop: 6,
  },
  logoutButton: {
    padding: "10px 16px",
    borderRadius: 10,
    border: 0,
    background: "#0f172a",
    color: "#ffffff",
    cursor: "pointer",
  },
  cardsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 16,
  },
  card: {
    background: "#ffffff",
    borderRadius: 16,
    padding: 20,
    boxShadow: "0 8px 20px rgba(0,0,0,0.06)",
  },
  cardTitle: {
    color: "#334155",
    fontSize: 15,
  },
  cardValue: {
    marginTop: 12,
    fontSize: 34,
    fontWeight: 700,
    color: "#0f172a",
  },
  section: {
    background: "#ffffff",
    borderRadius: 16,
    padding: 20,
    boxShadow: "0 8px 20px rgba(0,0,0,0.06)",
    marginTop: 24,
  },
  sectionMini: {
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  },
  sectionMiniTitle: {
    marginTop: 0,
    marginBottom: 16,
    color: "#0f172a",
  },
  sectionTitle: {
    marginTop: 0,
    color: "#0f172a",
  },
  mutedText: {
    color: "#64748b",
    marginBottom: 0,
  },
  formGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 12,
    marginBottom: 12,
  },
  tableWrap: {
    marginTop: 24,
    overflowX: "auto",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
  },
  th: {
    textAlign: "left",
    padding: 12,
    borderBottom: "1px solid #e2e8f0",
    color: "#334155",
    fontSize: 14,
    verticalAlign: "top",
  },
  td: {
    padding: 12,
    borderBottom: "1px solid #e2e8f0",
    fontSize: 14,
    color: "#0f172a",
    verticalAlign: "top",
  },
  minimosLista: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    minWidth: 240,
  },
  minimoLinha: {
    fontSize: 12,
    color: "#334155",
  },
  deleteButton: {
    padding: "8px 12px",
    borderRadius: 8,
    border: 0,
    background: "#dc2626",
    color: "#ffffff",
    cursor: "pointer",
  },
};
