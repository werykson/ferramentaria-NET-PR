import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "./supabaseClient";
import { theme } from "./theme.js";
import { captureException } from "./telemetry.js";

const CCS = [
  "CC NET APOIO PR",
  "CC NET CTA PR",
  "CC NET LDA PR",
  "CC NET MGA PR",
  "CC NET LITORAL PR",
  "CC NET SUDOESTE PR",
];

const CARGOS = [
  "Admin",
  "Gerente",
  "Coordenador",
  "SUP. Almoxarifado",
  "Sup. Técnico",
  "Ass.Logistica",
];

const MENU = [
  { key: "dashboard", label: "Dashboard", iconKey: "dashboard" },
  { key: "itens", label: "Itens", iconKey: "itens" },
  { key: "tecnicos", label: "Técnicos", iconKey: "tecnicos" },
  { key: "movimentacoes", label: "Movimentações", iconKey: "movimentacoes" },
  { key: "estoque", label: "Estoque", iconKey: "estoque" },
  { key: "usuarios", label: "Usuários", iconKey: "usuarios" },
];

const STORAGE_KEY_AUTH = "ferramentaria_net_pr_auth_v3";
const STORAGE_KEY_AUTH_ACTIVITY = "ferramentaria_net_pr_auth_activity_v1";
const STORAGE_KEY_TRI = "ferramentaria_net_pr_tri_v3";
const BRAND_LOGO_SRC = "/logo-eqs.png";
const DEFAULT_USER_PASSWORD = "EQS@123";
const MAX_INATIVIDADE_MS = 60 * 60 * 1000;

const TIPOS_MOV = [
  { value: "entrada", label: "Entrada em estoque" },
  { value: "saida_tecnico", label: "Saída para técnico" },
  { value: "devolucao_tecnico", label: "Devolução de técnico" },
  { value: "substituicao_perda", label: "Substituição por perda" },
  { value: "substituicao_quebra", label: "Substituição por quebra" },
  { value: "substituicao_desgaste", label: "Substituição por desgaste" },
  { value: "ajuste_positivo", label: "Ajuste positivo" },
  { value: "ajuste_negativo", label: "Ajuste negativo" },
];

const LABEL_TIPO = {
  entrada: "Entrada em estoque",
  saida_tecnico: "Saída para técnico",
  devolucao_tecnico: "Devolução de técnico",
  substituicao_perda: "Substituição por perda",
  substituicao_quebra: "Substituição por quebra",
  substituicao_desgaste: "Substituição por desgaste",
  ajuste_positivo: "Ajuste positivo",
  ajuste_negativo: "Ajuste negativo",
  triangulacao_saida: "Triangulação saída",
  triangulacao_entrada: "Triangulação entrada",
};

function normalizeHeaderKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
}

function ccToHeaderToken(cc) {
  return String(cc || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "_")
    .toUpperCase();
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function isHiddenFromUsersScreen(user) {
  const login = String(user?.usuario || "").trim().toLowerCase();
  return login === "admin";
}

const ITEM_HEADER_CODIGO = "CODIGO";
const ITEM_HEADER_NOME = "NOME";
const ITEM_HEADER_VALOR = "VALOR";
/** Legado: se existir sem as colunas MDU/INST, replica o valor nos dois kits. */
const ITEM_HEADER_QTD_KIT = "QTD_KIT";
const ITEM_HEADER_QTD_KIT_MDU = "QTD_KIT_MDU";
const ITEM_HEADER_QTD_KIT_INST = "QTD_KIT_INST";
const ITEM_MINIMO_HEADERS = CCS.map((cc) => ({
  cc,
  header: `MINIMO_${ccToHeaderToken(cc)}`,
}));

const TECNICO_HEADER_NOME = "NOME";
const TECNICO_HEADER_CC = "CC";

const emptyMinimos = () => Object.fromEntries(CCS.map((cc) => [cc, ""]));
const emptyItemForm = () => ({
  codigo: "",
  nome: "",
  valor: "",
  qtdKitMdu: "",
  qtdKitInst: "",
  minimos: emptyMinimos(),
});
const emptyTecnicoForm = () => ({ nome: "", cc: "" });
const emptyMovForm = () => ({
  tipo: "entrada",
  tecnico_id: "",
  item_id: "",
  cc: "",
  quantidade: "",
  observacao: "",
});
const emptyTriForm = () => ({
  cc_origem: "",
  cc_destino: "",
  item_id: "",
  quantidade: "",
  observacao: "",
});

const uid = () => `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

function safeLocalStorageGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function safeLocalStorageSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // noop
  }
}

function safeLocalStorageRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // noop
  }
}


function getDefaultPermissions(cargo) {
  const triangulacaoBase = ["Admin", "Gerente", "Coordenador"].includes(cargo);
  return {
    triangulacaoAcesso: triangulacaoBase,
    triangulacaoSolicitar: triangulacaoBase,
    triangulacaoAprovar: triangulacaoBase,
    visualizarValores: ["Admin", "Gerente", "Coordenador", "SUP. Almoxarifado"].includes(cargo),
    cadastroItens: ["Admin", "Gerente", "SUP. Almoxarifado"].includes(cargo),
    cadastroTecnicos: ["Admin", "Gerente", "SUP. Almoxarifado", "Coordenador", "Ass.Logistica"].includes(cargo),
  };
}

function normalizeUser(user) {
  const cargo = user?.cargo || "Ass.Logistica";
  const ccs = ["Admin", "Gerente", "SUP. Almoxarifado"].includes(cargo)
    ? [...CCS]
    : parseCCsValue(user?.ccs);
  return {
    ...user,
    ativo: user?.ativo !== false,
    mustChangePassword: user?.mustChangePassword === true,
    ccs,
    permissions: {
      ...getDefaultPermissions(cargo),
      ...(user?.permissions || {}),
      triangulacaoAcesso:
        typeof user?.permissions?.triangulacaoAcesso === "boolean"
          ? user.permissions.triangulacaoAcesso
          : typeof user?.permissions?.triangulacao === "boolean"
            ? user.permissions.triangulacao
            : getDefaultPermissions(cargo).triangulacaoAcesso,
      triangulacaoSolicitar:
        typeof user?.permissions?.triangulacaoSolicitar === "boolean"
          ? user.permissions.triangulacaoSolicitar
          : typeof user?.permissions?.triangulacao === "boolean"
            ? user.permissions.triangulacao
            : getDefaultPermissions(cargo).triangulacaoSolicitar,
      triangulacaoAprovar:
        typeof user?.permissions?.triangulacaoAprovar === "boolean"
          ? user.permissions.triangulacaoAprovar
          : typeof user?.permissions?.triangulacao === "boolean"
            ? user.permissions.triangulacao
            : getDefaultPermissions(cargo).triangulacaoAprovar,
    },
  };
}

function userHasPermission(usuario, key) {
  if (!usuario) return false;
  if (typeof usuario?.permissions?.[key] === "boolean") {
    return usuario.permissions[key];
  }
  return getDefaultPermissions(usuario?.cargo)[key] === true;
}

function toDbUserPayload(user) {
  const normalizado = normalizeUser(user);
  return {
    id: String(normalizado.id),
    nome: normalizado.nome,
    usuario: normalizado.usuario,
    senha: normalizado.senha,
    cargo: normalizado.cargo,
    ccs: normalizado.ccs || [],
    permissions: normalizado.permissions || {},
    ativo: normalizado.ativo !== false,
    must_change_password: normalizado.mustChangePassword === true,
  };
}

function fromDbUserRow(row) {
  return normalizeUser({
    ...row,
    mustChangePassword: row?.must_change_password === true,
  });
}

function loadTriangulacoes() {
  return safeLocalStorageGet(STORAGE_KEY_TRI, []);
}

function triRegistroFromDbRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    cc_origem: row.cc_origem,
    cc_destino: row.cc_destino,
    item_id: row.item_id,
    quantidade: row.quantidade,
    observacao: row.observacao || "",
    solicitado_por: row.solicitado_por || "-",
    solicitado_nome: row.solicitado_nome || "-",
    status: row.status,
    aprovado_por: row.aprovado_por || null,
    aprovado_nome: row.aprovado_nome || null,
    approved_at: row.approved_at || null,
    created_at: row.created_at,
  };
}

function triRegistroToDbRow(t) {
  return {
    id: t.id,
    cc_origem: t.cc_origem,
    cc_destino: t.cc_destino,
    item_id: Number(t.item_id),
    quantidade: Number(t.quantidade),
    observacao: t.observacao?.trim() || null,
    solicitado_por: t.solicitado_por || null,
    solicitado_nome: t.solicitado_nome || null,
    status: t.status || "Pendente",
    aprovado_por: t.aprovado_por || null,
    aprovado_nome: t.aprovado_nome || null,
    approved_at: t.approved_at || null,
    created_at: t.created_at || new Date().toISOString(),
  };
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function roleCanViewAll(usuario) {
  return ["Admin", "Gerente", "Coordenador", "SUP. Almoxarifado"].includes(
    usuario?.cargo
  );
}

function roleCanManageItems(usuario) {
  return userHasPermission(usuario, "cadastroItens");
}

function roleCanManageUsers(usuario) {
  return ["Admin", "Gerente"].includes(usuario?.cargo);
}

function roleCanManageCC(usuario, cc) {
  if (!usuario) return false;
  if (["Admin", "Gerente", "SUP. Almoxarifado"].includes(usuario.cargo)) {
    return true;
  }
  if (["Coordenador", "Ass.Logistica"].includes(usuario.cargo)) {
    return (usuario.ccs || []).includes(cc);
  }
  return false;
}

function roleCanViewCC(usuario, cc) {
  if (!usuario) return false;
  if (roleCanViewAll(usuario)) return true;
  return (usuario.ccs || []).includes(cc);
}

function roleCanApproveTriangulacao(usuario, origem, destino) {
  if (!usuario || !canUseTriangulacao(usuario) || !userHasPermission(usuario, "triangulacaoAprovar")) return false;
  if (["Admin", "Gerente"].includes(usuario.cargo)) return true;
  if (usuario.cargo === "Coordenador") {
    return (usuario.ccs || []).includes(origem) && (usuario.ccs || []).includes(destino);
  }
  return false;
}

function canUseTriangulacao(usuario) {
  return userHasPermission(usuario, "triangulacaoAcesso");
}

function canRequestTriangulacao(usuario) {
  return canUseTriangulacao(usuario) && userHasPermission(usuario, "triangulacaoSolicitar");
}

function roleCanCreateCadastrosTecnicos(usuario, cc) {
  if (!usuario || !userHasPermission(usuario, "cadastroTecnicos")) return false;
  if (["Admin", "Gerente", "SUP. Almoxarifado"].includes(usuario.cargo)) return true;
  if (["Coordenador", "Ass.Logistica"].includes(usuario.cargo)) {
    return (usuario.ccs || []).includes(cc);
  }
  return false;
}

function canViewDashboardValues(usuario) {
  return userHasPermission(usuario, "visualizarValores");
}

function parseCCsValue(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function downloadWorkbook(filename, sheetName, rows) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}

function downloadWorkbookSheets(filename, sheets) {
  const wb = XLSX.utils.book_new();
  sheets.forEach((sheet) => {
    const ws = XLSX.utils.json_to_sheet(sheet.rows);
    XLSX.utils.book_append_sheet(wb, ws, sheet.name);
  });
  XLSX.writeFile(wb, filename);
}

function readExcelValue(row, aliases) {
  const normalized = Object.fromEntries(
    Object.entries(row || {}).map(([key, value]) => [normalizeHeaderKey(key), value])
  );
  for (const alias of aliases) {
    const value = normalized[normalizeHeaderKey(alias)];
    if (value !== undefined) return value;
  }
  return "";
}

function getSupabaseErrorMessage(error, fallback) {
  if (!error) return fallback;
  const raw = [error.message, error.code, error.details]
    .filter(Boolean)
    .join(" | ");
  const normalized = String(raw || "").toLowerCase();

  if (
    normalized.includes("failed to fetch") ||
    normalized.includes("fetch failed") ||
    normalized.includes("networkerror") ||
    normalized.includes("timeout")
  ) {
    return "Falha de conexão com o banco (rede/timeout). Verifique internet, firewall/proxy e tente novamente.";
  }

  if (normalized.includes("42p01") || normalized.includes("does not exist")) {
    return "Tabela ou coluna ausente no banco. Rode as migrações SQL mais recentes no Supabase e tente de novo.";
  }

  return raw || fallback;
}

async function withQueryTimeout(promise, label, timeoutMs = 12000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout: ${label}`)), timeoutMs)
    ),
  ]);
}

async function insertMovimentacoesComAutor(linhas, usuario) {
  const payloadComAutor = linhas.map((linha) => ({
    ...linha,
    movimentado_por: usuario?.usuario || null,
    movimentado_nome: usuario?.nome || null,
  }));

  const tentativaComAutor = await supabase.from("movimentacoes").insert(payloadComAutor);
  if (!tentativaComAutor.error) {
    return { error: null, salvouAutor: true };
  }

  const erroTexto = String(tentativaComAutor.error?.message || "").toLowerCase();
  const colunaAutorAusente =
    erroTexto.includes("movimentado_por") ||
    erroTexto.includes("movimentado_nome");

  if (!colunaAutorAusente) {
    return { error: tentativaComAutor.error, salvouAutor: false };
  }

  const tentativaLegado = await supabase.from("movimentacoes").insert(linhas);
  return { error: tentativaLegado.error || null, salvouAutor: false };
}

function validarPoliticaSenha(senha) {
  const valor = String(senha || "").trim();
  if (valor.length < 8) {
    return "A senha deve ter pelo menos 8 caracteres.";
  }
  if (!/\d/.test(valor)) {
    return "A senha deve conter pelo menos 1 número.";
  }
  return null;
}

export default function App() {
  const [usuariosSistema, setUsuariosSistema] = useState([]);
  const [carregandoUsuarios, setCarregandoUsuarios] = useState(true);
  const [erroUsuarios, setErroUsuarios] = useState("");
  const [usuarioAtual, setUsuarioAtual] = useState(() =>
    safeLocalStorageGet(STORAGE_KEY_AUTH, null)
  );
  const [usuarioLogin, setUsuarioLogin] = useState("");
  const [senhaLogin, setSenhaLogin] = useState("");
  const [novaSenhaObrigatoria, setNovaSenhaObrigatoria] = useState("");
  const [confirmarSenhaObrigatoria, setConfirmarSenhaObrigatoria] = useState("");
  const [pagina, setPagina] = useState("dashboard");
  const [dashboardAbaAtiva, setDashboardAbaAtiva] = useState("criticos");
  const [movimentacoesAbaAtiva, setMovimentacoesAbaAtiva] = useState("lancar");
  const [dashboardModo, setDashboardModo] = useState("resumo");
  const [dashboardFiltroCc, setDashboardFiltroCc] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [carregandoMovimentacoes, setCarregandoMovimentacoes] = useState(true);

  const [itens, setItens] = useState([]);
  const [itemForm, setItemForm] = useState(emptyItemForm);
  const [itemEditandoId, setItemEditandoId] = useState(null);
  const [itemEdicaoDraft, setItemEdicaoDraft] = useState(emptyItemForm);

  const [tecnicos, setTecnicos] = useState([]);
  const [tecnicoForm, setTecnicoForm] = useState(emptyTecnicoForm);
  const [buscaTecnico, setBuscaTecnico] = useState("");
  const [tecnicoEditandoId, setTecnicoEditandoId] = useState(null);
  const [tecnicoEdicaoDraft, setTecnicoEdicaoDraft] = useState({ nome: "", cc: "" });

  const [movimentacoes, setMovimentacoes] = useState([]);
  const [movForm, setMovForm] = useState(emptyMovForm);
  const [loteMovimentacoes, setLoteMovimentacoes] = useState([]);
  const [movBuscaItem, setMovBuscaItem] = useState("");
  const [movBuscaTecnico, setMovBuscaTecnico] = useState("");

  const [triangulacoes, setTriangulacoes] = useState([]);
  const [triForm, setTriForm] = useState(emptyTriForm);
  const [loteTriangulacoes, setLoteTriangulacoes] = useState([]);
  const [toasts, setToasts] = useState([]);

  const notify = useCallback((message, variant = "info") => {
    const id = uid();
    setToasts((prev) => [...prev, { id, message, variant }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4500);
  }, []);

  const [estoqueFiltro, setEstoqueFiltro] = useState({ cc: "", tecnico_id: "", item_id: "", busca_nome: "" });
  const [mostrarItensZerados, setMostrarItensZerados] = useState(false);

  const [usuarioForm, setUsuarioForm] = useState({
    nome: "",
    usuario: "",
    senha: "",
    cargo: "Gerente",
    ccs: [...CCS],
    ativo: true,
    permissions: getDefaultPermissions("Gerente"),
  });
  const [usuarioExpandidoId, setUsuarioExpandidoId] = useState(null);
  const [buscaUsuario, setBuscaUsuario] = useState("");
  const [buscaItem, setBuscaItem] = useState("");

  useEffect(() => {
    if (pagina === "usuarios" && !roleCanManageUsers(usuarioAtual)) {
      setPagina("dashboard");
    }
  }, [pagina, usuarioAtual]);

  useEffect(() => {
    if (pagina !== "dashboard") setDashboardModo("resumo");
  }, [pagina]);

  useEffect(() => {
    if (pagina !== "itens") setItemEditandoId(null);
  }, [pagina]);

  const carregarUsuariosSistema = async () => {
    setCarregandoUsuarios(true);
    const timeoutMs = 12000;
    const withTimeout = (promise, label) =>
      Promise.race([
        promise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout: ${label}`)), timeoutMs)
        ),
      ]);

    try {
      let data = null;
      let queryError = null;
      try {
        const resultado = await withTimeout(
          supabase.from("usuarios").select("*").order("nome", { ascending: true }),
          "buscar usuários"
        );
        data = resultado?.data ?? null;
        queryError = resultado?.error ?? null;
      } catch (err) {
        queryError = err;
      }

      if (queryError) {
        console.error(queryError);
        setUsuariosSistema([]);
        setErroUsuarios(
          getSupabaseErrorMessage(
            queryError,
            "Não foi possível conectar no banco para carregar usuários."
          )
        );
        return;
      }

      if (!Array.isArray(data) || data.length === 0) {
        const adminPadrao = normalizeUser({
          id: uid(),
          nome: "Administrador",
          usuario: "admin",
          senha: "admin123",
          cargo: "Admin",
          ccs: [...CCS],
          ativo: true,
        });
        let insertError = null;
        try {
          const insertResult = await withTimeout(
            supabase.from("usuarios").insert([toDbUserPayload(adminPadrao)]),
            "inserir admin inicial"
          );
          insertError = insertResult?.error ?? null;
        } catch (err) {
          insertError = err;
        }
        if (insertError) {
          console.error(insertError);
          setUsuariosSistema([]);
          setErroUsuarios("Tabela de usuários vazia e não foi possível criar o admin inicial.");
        } else {
          setUsuariosSistema([adminPadrao]);
          setErroUsuarios("");
        }
        return;
      }

      setUsuariosSistema(data.map(fromDbUserRow));
      setErroUsuarios("");
    } finally {
      setCarregandoUsuarios(false);
    }
  };

  const buscarItens = async () => {
    let data = null;
    let error = null;
    try {
      const resultado = await withQueryTimeout(
        supabase.from("itens").select("*").order("id", { ascending: false }),
        "buscar itens"
      );
      data = resultado?.data || null;
      error = resultado?.error || null;
    } catch (err) {
      error = err;
    }
    if (error) {
      console.error(error);
      alert(getSupabaseErrorMessage(error, "Erro ao buscar itens no banco."));
      return;
    }
    setItens(
      (data || []).map((item) => {
        const legacy = Number(item.qtd_kit ?? 0);
        return {
          ...item,
          valor: Number(item.valor || 0),
          qtdKitMdu: Number(item.qtd_kit_mdu ?? legacy),
          qtdKitInst: Number(item.qtd_kit_inst ?? legacy),
          minimos: item.minimos || {},
        };
      })
    );
  };

  const buscarTecnicos = async () => {
    let data = null;
    let error = null;
    try {
      const resultado = await withQueryTimeout(
        supabase.from("tecnicos").select("*").order("nome", { ascending: true }),
        "buscar técnicos"
      );
      data = resultado?.data || null;
      error = resultado?.error || null;
    } catch (err) {
      error = err;
    }
    if (error) {
      console.error(error);
      alert(getSupabaseErrorMessage(error, "Erro ao buscar técnicos."));
      return;
    }
    setTecnicos(data || []);
  };

  const buscarMovimentacoes = async () => {
    let data = null;
    let error = null;
    try {
      const resultado = await withQueryTimeout(
        supabase
          .from("movimentacoes")
          .select("*")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false }),
        "buscar movimentações"
      );
      data = resultado?.data || null;
      error = resultado?.error || null;
    } catch (err) {
      error = err;
    }
    if (error) {
      console.error(error);
      alert(getSupabaseErrorMessage(error, "Erro ao buscar movimentações."));
      return;
    }
    setMovimentacoes(data || []);
  };

  const buscarTriangulacoes = async () => {
    let data = null;
    let error = null;
    try {
      const resultado = await withQueryTimeout(
        supabase.from("triangulacoes").select("*").order("created_at", { ascending: false }),
        "buscar triangulações"
      );
      data = resultado?.data ?? null;
      error = resultado?.error ?? null;
    } catch (err) {
      error = err;
    }
    if (error) {
      console.error(error);
      captureException(error, { op: "buscarTriangulacoes" });
      setTriangulacoes([]);
      notify(
        getSupabaseErrorMessage(
          error,
          "Não foi possível carregar triangulações. Rode sql_migration_triangulacoes.sql no Supabase se ainda não rodou."
        ),
        "error"
      );
      return;
    }
    let list = (data || []).map(triRegistroFromDbRow).filter(Boolean);
    const legado = loadTriangulacoes();
    if (legado.length > 0) {
      const dbIds = new Set(list.map((t) => t.id));
      const migrar = legado.filter((t) => t.id && !dbIds.has(t.id));
      if (migrar.length > 0) {
        const { error: insErr } = await supabase
          .from("triangulacoes")
          .insert(migrar.map((t) => triRegistroToDbRow(t)));
        if (!insErr) {
          safeLocalStorageSet(STORAGE_KEY_TRI, []);
          try {
            const r2 = await withQueryTimeout(
              supabase.from("triangulacoes").select("*").order("created_at", { ascending: false }),
              "recarregar triangulações"
            );
            if (!r2.error && r2.data) list = r2.data.map(triRegistroFromDbRow).filter(Boolean);
          } catch {
            /* noop */
          }
          notify(`${migrar.length} triangulação(ões) migradas do navegador para o banco.`, "success");
        }
      }
    }
    setTriangulacoes(list);
  };

  const carregarTudo = async () => {
    setCarregando(true);
    setCarregandoMovimentacoes(true);
    try {
      await Promise.allSettled([buscarItens(), buscarTecnicos(), buscarTriangulacoes()]);
    } finally {
      setCarregando(false);
    }
    try {
      await buscarMovimentacoes();
    } finally {
      setCarregandoMovimentacoes(false);
    }
  };

  useEffect(() => {
    carregarTudo();
  }, []);

  useEffect(() => {
    carregarUsuariosSistema();
  }, []);

  useEffect(() => {
    if (!usuarioAtual) return;
    const atualizado = normalizeUser(usuarioAtual);
    if (JSON.stringify(atualizado) !== JSON.stringify(usuarioAtual)) {
      setUsuarioAtual(atualizado);
      safeLocalStorageSet(STORAGE_KEY_AUTH, atualizado);
    }
  }, [usuarioAtual]);

  useEffect(() => {
    if (!usuarioAtual) return;

    const marcarAtividade = () => safeLocalStorageSet(STORAGE_KEY_AUTH_ACTIVITY, Date.now());
    const ultimaAtividade = Number(safeLocalStorageGet(STORAGE_KEY_AUTH_ACTIVITY, 0));
    if (!ultimaAtividade) marcarAtividade();

    const eventosAtividade = [
      "mousedown",
      "mousemove",
      "keydown",
      "scroll",
      "touchstart",
      "click",
    ];

    eventosAtividade.forEach((evento) => {
      window.addEventListener(evento, marcarAtividade, { passive: true });
    });

    const timerVerificacao = setInterval(() => {
      const ultimoRegistro = Number(safeLocalStorageGet(STORAGE_KEY_AUTH_ACTIVITY, 0));
      if (!ultimoRegistro) return;
      if (Date.now() - ultimoRegistro > MAX_INATIVIDADE_MS) {
        alert("Sessão encerrada por inatividade (mais de 1 hora). Faça login novamente.");
        sair();
      }
    }, 30000);

    return () => {
      clearInterval(timerVerificacao);
      eventosAtividade.forEach((evento) => {
        window.removeEventListener(evento, marcarAtividade);
      });
    };
  }, [usuarioAtual]);

  const itensById = useMemo(
    () => Object.fromEntries(itens.map((item) => [Number(item.id), item])),
    [itens]
  );
  const tecnicosById = useMemo(
    () => Object.fromEntries(tecnicos.map((tecnico) => [Number(tecnico.id), tecnico])),
    [tecnicos]
  );

  const saldoEstoqueCCItem = useMemo(() => {
    const mapa = {};
    movimentacoes.forEach((mov) => {
      const cc = mov.cc || "SEM_CC";
      const itemId = Number(mov.item_id);
      const chave = `${cc}-${itemId}`;
      const quantidade = Number(mov.quantidade || 0);
      if (!mapa[chave]) mapa[chave] = 0;

      if (["entrada", "devolucao_tecnico", "ajuste_positivo", "triangulacao_entrada"].includes(mov.tipo)) {
        mapa[chave] += quantidade;
      }

      if ([
        "saida_tecnico",
        "ajuste_negativo",
        "substituicao_perda",
        "substituicao_quebra",
        "substituicao_desgaste",
        "triangulacao_saida",
      ].includes(mov.tipo)) {
        mapa[chave] -= quantidade;
      }
    });
    return mapa;
  }, [movimentacoes]);

  const saldoTecnicoItem = useMemo(() => {
    const mapa = {};
    movimentacoes.forEach((mov) => {
      if (!mov.tecnico_id) return;
      const tecnicoId = Number(mov.tecnico_id);
      const itemId = Number(mov.item_id);
      const chave = `${tecnicoId}-${itemId}`;
      const quantidade = Number(mov.quantidade || 0);
      if (!mapa[chave]) mapa[chave] = 0;

      if (mov.tipo === "saida_tecnico") mapa[chave] += quantidade;
      if (mov.tipo === "devolucao_tecnico") mapa[chave] -= quantidade;
    });
    return mapa;
  }, [movimentacoes]);

  const estoquePorTecnico = useMemo(() => {
    return Object.entries(saldoTecnicoItem)
      .map(([chave, quantidade]) => {
        const [tecnicoId, itemId] = chave.split("-");
        const tecnico = tecnicosById[Number(tecnicoId)];
        const item = itensById[Number(itemId)];
        return {
          tecnico_id: Number(tecnicoId),
          item_id: Number(itemId),
          tecnicoNome: tecnico?.nome || "-",
          cc: tecnico?.cc || "-",
          itemNome: item?.nome || `Item #${itemId}`,
          quantidade: Number(quantidade || 0),
        };
      })
      .filter((registro) => registro.quantidade > 0)
      .filter((registro) => roleCanViewCC(usuarioAtual, registro.cc))
      .sort((a, b) => a.tecnicoNome.localeCompare(b.tecnicoNome, "pt-BR"));
  }, [saldoTecnicoItem, tecnicosById, itensById, usuarioAtual]);

  const ccsDisponiveisDashboard = useMemo(
    () => CCS.filter((cc) => roleCanViewCC(usuarioAtual, cc)),
    [usuarioAtual]
  );

  useEffect(() => {
    if (dashboardFiltroCc && !ccsDisponiveisDashboard.includes(dashboardFiltroCc)) {
      setDashboardFiltroCc("");
    }
  }, [dashboardFiltroCc, ccsDisponiveisDashboard]);

  const estoqueGeral = useMemo(() => {
  const mapa = {};

  Object.entries(saldoEstoqueCCItem).forEach(([chave, quantidade]) => {
    const splitIndex = chave.lastIndexOf("-");
    const cc = chave.slice(0, splitIndex);
    const itemId = Number(chave.slice(splitIndex + 1));
    const item = itensById[itemId];

    const registroKey = `${cc}-${itemId}`;

    if (!mapa[registroKey]) {
      mapa[registroKey] = {
        cc,
        itemId,
        itemNome: item?.nome || `Item #${itemId}`,
        estoque: 0,
        comTecnico: 0,
        minimo: Number(item?.minimos?.[cc] || 0),
        valor: Number(item?.valor || 0),
      };
    }

    mapa[registroKey].estoque = Number(quantidade || 0);
  });

  Object.entries(saldoTecnicoItem).forEach(([chave, quantidade]) => {
    const splitIndex = chave.lastIndexOf("-");
    const tecnicoId = Number(chave.slice(0, splitIndex));
    const itemId = Number(chave.slice(splitIndex + 1));

    const tecnico = tecnicosById[tecnicoId];
    if (!tecnico) return;

    const cc = tecnico.cc;
    const item = itensById[itemId];
    const registroKey = `${cc}-${itemId}`;

    if (!mapa[registroKey]) {
      mapa[registroKey] = {
        cc,
        itemId,
        itemNome: item?.nome || `Item #${itemId}`,
        estoque: 0,
        comTecnico: 0,
        minimo: Number(item?.minimos?.[cc] || 0),
        valor: Number(item?.valor || 0),
      };
    }

    mapa[registroKey].comTecnico += Number(quantidade || 0);
  });

  return Object.values(mapa)
    .map((registro) => ({
      ...registro,
      total: Number(registro.estoque || 0) + Number(registro.comTecnico || 0),
    }))
    .sort((a, b) => {
      const ccCompare = a.cc.localeCompare(b.cc, "pt-BR");
      if (ccCompare !== 0) return ccCompare;
      return a.itemNome.localeCompare(b.itemNome, "pt-BR");
    });
}, [saldoEstoqueCCItem, saldoTecnicoItem, itensById, tecnicosById]);

  const indicadoresDashboard = useMemo(() => {
    const ccFiltroAtivo = String(dashboardFiltroCc || "").trim();
    const matchFiltroCc = (cc) => !ccFiltroAtivo || cc === ccFiltroAtivo;
    const ccsDashboard = ccsDisponiveisDashboard.filter((cc) => matchFiltroCc(cc));

    const itensCriticos = estoqueGeral.filter(
      (registro) =>
        roleCanViewCC(usuarioAtual, registro.cc) &&
        matchFiltroCc(registro.cc) &&
        registro.minimo > 0 &&
        Number(registro.estoque || 0) < Number(registro.minimo || 0)
    );

    const substituicoes = {};
    const substituicoesPorTecnico = {};
    movimentacoes.forEach((mov) => {
      if (!["substituicao_perda", "substituicao_quebra", "substituicao_desgaste"].includes(mov.tipo)) return;
      const item = itensById[Number(mov.item_id)];
      const cc = mov.cc || "";
      if (!roleCanViewCC(usuarioAtual, cc)) return;
      if (!matchFiltroCc(cc)) return;
      const chave = String(mov.item_id);
      if (!substituicoes[chave]) {
        substituicoes[chave] = {
          item_id: Number(mov.item_id),
          itemNome: item?.nome || `Item #${mov.item_id}`,
          total: 0,
          perda: 0,
          quebra: 0,
          desgaste: 0,
        };
      }
      const qtd = Number(mov.quantidade || 0);
      substituicoes[chave].total += qtd;
      if (mov.tipo === "substituicao_perda") substituicoes[chave].perda += qtd;
      if (mov.tipo === "substituicao_quebra") substituicoes[chave].quebra += qtd;
      if (mov.tipo === "substituicao_desgaste") substituicoes[chave].desgaste += qtd;

      if (mov.tecnico_id) {
        const tecnicoId = Number(mov.tecnico_id);
        const tecnico = tecnicosById[tecnicoId];
        const chaveTecnico = String(tecnicoId);
        if (!substituicoesPorTecnico[chaveTecnico]) {
          substituicoesPorTecnico[chaveTecnico] = {
            tecnico_id: tecnicoId,
            tecnicoNome: tecnico?.nome || `Técnico #${tecnicoId}`,
            cc: tecnico?.cc || cc || "-",
            total: 0,
            perda: 0,
            quebra: 0,
            desgaste: 0,
          };
        }
        substituicoesPorTecnico[chaveTecnico].total += qtd;
        if (mov.tipo === "substituicao_perda") substituicoesPorTecnico[chaveTecnico].perda += qtd;
        if (mov.tipo === "substituicao_quebra") substituicoesPorTecnico[chaveTecnico].quebra += qtd;
        if (mov.tipo === "substituicao_desgaste") substituicoesPorTecnico[chaveTecnico].desgaste += qtd;
      }
    });

    const rankingSubstituicoes = Object.values(substituicoes).sort((a, b) => b.total - a.total);
    const rankingSubstituicoesTecnicos = Object.values(substituicoesPorTecnico).sort(
      (a, b) => b.total - a.total
    );

    return {
      itensCriticos,
      top10ItensSubstituidos: rankingSubstituicoes.slice(0, 10),
      top10TecnicosSubstituidores: rankingSubstituicoesTecnicos.slice(0, 10),
      totalItens: itens.length,
      totalKitsDisponiveisMdu: (() => {
        const itensComKit = itens.filter((item) => Number(item.qtdKitMdu ?? 0) > 0);
        if (itensComKit.length === 0) return 0;
        const estoqueAlmoxarifadoPorCcItem = {};
        estoqueGeral.forEach((r) => {
          estoqueAlmoxarifadoPorCcItem[`${r.cc}-${Number(r.itemId)}`] = Number(r.estoque || 0);
        });
        return ccsDashboard.reduce((sumCc, cc) => {
          const kitsPorItem = itensComKit.map((item) => {
            const qtd = Number(item.qtdKitMdu ?? 0);
            const est = estoqueAlmoxarifadoPorCcItem[`${cc}-${Number(item.id)}`] ?? 0;
            return Math.floor(est / qtd);
          });
          return sumCc + Math.min(...kitsPorItem);
        }, 0);
      })(),
      totalKitsDisponiveisInst: (() => {
        const itensComKit = itens.filter((item) => Number(item.qtdKitInst ?? 0) > 0);
        if (itensComKit.length === 0) return 0;
        const estoqueAlmoxarifadoPorCcItem = {};
        estoqueGeral.forEach((r) => {
          estoqueAlmoxarifadoPorCcItem[`${r.cc}-${Number(r.itemId)}`] = Number(r.estoque || 0);
        });
        return ccsDashboard.reduce((sumCc, cc) => {
          const kitsPorItem = itensComKit.map((item) => {
            const qtd = Number(item.qtdKitInst ?? 0);
            const est = estoqueAlmoxarifadoPorCcItem[`${cc}-${Number(item.id)}`] ?? 0;
            return Math.floor(est / qtd);
          });
          return sumCc + Math.min(...kitsPorItem);
        }, 0);
      })(),
      valorReferenciaKitsMdu: itens.reduce((acc, item) => {
        const qtd = Number(item.qtdKitMdu ?? 0);
        if (qtd <= 0) return acc;
        return acc + Number(item.valor || 0) * qtd;
      }, 0),
      valorReferenciaKitsInst: itens.reduce((acc, item) => {
        const qtd = Number(item.qtdKitInst ?? 0);
        if (qtd <= 0) return acc;
        return acc + Number(item.valor || 0) * qtd;
      }, 0),
      totalTecnicos: tecnicos.filter((tec) => roleCanViewCC(usuarioAtual, tec.cc) && matchFiltroCc(tec.cc)).length,
      totalNoEstoque: estoqueGeral
        .filter((registro) => roleCanViewCC(usuarioAtual, registro.cc) && matchFiltroCc(registro.cc))
        .reduce((acc, item) => acc + Number(item.estoque || 0), 0),
      totalComTecnicos: estoquePorTecnico
        .filter((registro) => matchFiltroCc(registro.cc))
        .reduce((acc, item) => acc + Number(item.quantidade || 0), 0),
      valorTotalNoEstoque: estoqueGeral
        .filter((registro) => roleCanViewCC(usuarioAtual, registro.cc) && matchFiltroCc(registro.cc))
        .reduce((acc, item) => acc + Number(item.estoque || 0) * Number(item.valor || 0), 0),
      valorTotalComTecnicos: estoqueGeral
        .filter((registro) => roleCanViewCC(usuarioAtual, registro.cc) && matchFiltroCc(registro.cc))
        .reduce((acc, item) => acc + Number(item.comTecnico || 0) * Number(item.valor || 0), 0),
    };
  }, [
    estoqueGeral,
    movimentacoes,
    itens,
    itensById,
    tecnicos,
    estoquePorTecnico,
    usuarioAtual,
    dashboardFiltroCc,
    ccsDisponiveisDashboard,
  ]);

  const login = () => {
    if (carregandoUsuarios) {
      alert("Aguarde, carregando usuários...");
      return;
    }
    if (erroUsuarios) {
      alert(erroUsuarios);
      return;
    }
    const loginDigitado = String(usuarioLogin || "").trim().toLowerCase();
    const encontrado = usuariosSistema.find(
      (u) =>
        u.ativo !== false &&
        String(u.usuario || "").trim().toLowerCase() === loginDigitado &&
        u.senha === senhaLogin
    );
    if (!encontrado) {
      alert("Login inválido.");
      return;
    }
    const usuarioNormalizado = normalizeUser(encontrado);
    setUsuarioAtual(usuarioNormalizado);
    safeLocalStorageSet(STORAGE_KEY_AUTH, usuarioNormalizado);
    safeLocalStorageSet(STORAGE_KEY_AUTH_ACTIVITY, Date.now());
  };

  const sair = () => {
    setUsuarioAtual(null);
    setUsuarioLogin("");
    setSenhaLogin("");
    setNovaSenhaObrigatoria("");
    setConfirmarSenhaObrigatoria("");
    setPagina("dashboard");
    safeLocalStorageRemove(STORAGE_KEY_AUTH);
    safeLocalStorageRemove(STORAGE_KEY_AUTH_ACTIVITY);
  };

  const alterarSenhaObrigatoria = () => {
    if (!usuarioAtual) return;
    if (!novaSenhaObrigatoria.trim() || !confirmarSenhaObrigatoria.trim()) {
      alert("Preencha a nova senha e a confirmação.");
      return;
    }
    if (novaSenhaObrigatoria !== confirmarSenhaObrigatoria) {
      alert("A confirmação da senha não confere.");
      return;
    }
    const erroSenha = validarPoliticaSenha(novaSenhaObrigatoria);
    if (erroSenha) {
      alert(erroSenha);
      return;
    }

    const senhaAtualizada = novaSenhaObrigatoria.trim();

    supabase
      .from("usuarios")
      .update({ senha: senhaAtualizada, must_change_password: false })
      .eq("id", usuarioAtual.id)
      .then(({ error }) => {
        if (error) console.error(error);
      });

    setUsuariosSistema((prev) =>
      prev.map((u) =>
        u.id === usuarioAtual.id
          ? normalizeUser({ ...u, senha: senhaAtualizada, mustChangePassword: false })
          : normalizeUser(u)
      )
    );

    const usuarioAtualizado = normalizeUser({
      ...usuarioAtual,
      senha: senhaAtualizada,
      mustChangePassword: false,
    });
    setUsuarioAtual(usuarioAtualizado);
    safeLocalStorageSet(STORAGE_KEY_AUTH, usuarioAtualizado);
    setNovaSenhaObrigatoria("");
    setConfirmarSenhaObrigatoria("");
    alert("Senha alterada com sucesso.");
  };

  const cadastrarItem = async () => {
    if (!roleCanManageItems(usuarioAtual)) {
      alert("Seu perfil não pode cadastrar itens.");
      return;
    }
    if (!itemForm.codigo.trim() || !itemForm.nome.trim()) {
      alert("Preencha o código e o nome do item.");
      return;
    }

    const payload = {
      codigo: itemForm.codigo.trim(),
      nome: itemForm.nome.trim(),
      valor: Number(itemForm.valor || 0),
      qtd_kit_mdu: Number(itemForm.qtdKitMdu || 0),
      qtd_kit_inst: Number(itemForm.qtdKitInst || 0),
      minimos: Object.fromEntries(CCS.map((cc) => [cc, Number(itemForm.minimos[cc] || 0)])),
    };

    const { error } = await supabase.from("itens").insert([payload]);
    if (error) {
      console.error(error);
      alert("Erro ao salvar item no banco.");
      return;
    }
    await buscarItens();
    setItemForm(emptyItemForm());
  };

  const excluirItem = async (id) => {
    if (!roleCanManageItems(usuarioAtual)) {
      alert("Seu perfil não pode excluir itens.");
      return;
    }
    const possuiMovimentacao = movimentacoes.some((mov) => Number(mov.item_id) === Number(id));
    if (possuiMovimentacao) {
      alert("Este item já possui movimentações vinculadas.");
      return;
    }
    const { error } = await supabase.from("itens").delete().eq("id", id);
    if (error) {
      console.error(error);
      alert("Erro ao excluir item.");
      return;
    }
    await buscarItens();
  };

  const salvarEdicaoItem = async () => {
    if (!roleCanManageItems(usuarioAtual) || !itemEditandoId) return;
    if (!itemEdicaoDraft.codigo.trim() || !itemEdicaoDraft.nome.trim()) {
      alert("Preencha o código e o nome do item.");
      return;
    }
    const payload = {
      codigo: itemEdicaoDraft.codigo.trim(),
      nome: itemEdicaoDraft.nome.trim(),
      valor: Number(itemEdicaoDraft.valor || 0),
      qtd_kit_mdu: Number(itemEdicaoDraft.qtdKitMdu || 0),
      qtd_kit_inst: Number(itemEdicaoDraft.qtdKitInst || 0),
      minimos: Object.fromEntries(CCS.map((cc) => [cc, Number(itemEdicaoDraft.minimos[cc] || 0)])),
    };
    const { error } = await supabase.from("itens").update(payload).eq("id", itemEditandoId);
    if (error) {
      console.error(error);
      alert(getSupabaseErrorMessage(error, "Erro ao atualizar item."));
      return;
    }
    await buscarItens();
    setItemEditandoId(null);
    setItemEdicaoDraft(emptyItemForm());
  };

  const iniciarEdicaoItem = (item) => {
    setItemEditandoId(item.id);
    setItemEdicaoDraft({
      codigo: item.codigo || "",
      nome: item.nome || "",
      valor: item.valor !== undefined && item.valor !== null ? String(item.valor) : "",
      qtdKitMdu:
        item.qtdKitMdu !== undefined && item.qtdKitMdu !== null
          ? String(item.qtdKitMdu)
          : String(item.qtd_kit_mdu ?? ""),
      qtdKitInst:
        item.qtdKitInst !== undefined && item.qtdKitInst !== null
          ? String(item.qtdKitInst)
          : String(item.qtd_kit_inst ?? ""),
      minimos: Object.fromEntries(CCS.map((cc) => [cc, String(item.minimos?.[cc] ?? "")])),
    });
  };

  const cancelarEdicaoItem = () => {
    setItemEditandoId(null);
    setItemEdicaoDraft(emptyItemForm());
  };

  const exportarItensExcel = () => {
    const rows = itens.map((item) => ({
      [ITEM_HEADER_CODIGO]: item.codigo,
      [ITEM_HEADER_NOME]: item.nome,
      [ITEM_HEADER_VALOR]: Number(item.valor || 0),
      [ITEM_HEADER_QTD_KIT_MDU]: Number(item.qtdKitMdu ?? item.qtd_kit_mdu ?? 0),
      [ITEM_HEADER_QTD_KIT_INST]: Number(item.qtdKitInst ?? item.qtd_kit_inst ?? 0),
      ...Object.fromEntries(
        ITEM_MINIMO_HEADERS.map(({ cc, header }) => [header, Number(item.minimos?.[cc] || 0)])
      ),
    }));
    downloadWorkbook("itens_ferramentaria.xlsx", "Itens", rows);
  };

  const baixarModeloItensExcel = () => {
    const modelo = {
      [ITEM_HEADER_CODIGO]: "",
      [ITEM_HEADER_NOME]: "",
      [ITEM_HEADER_VALOR]: 0,
      [ITEM_HEADER_QTD_KIT_MDU]: 0,
      [ITEM_HEADER_QTD_KIT_INST]: 0,
      ...Object.fromEntries(ITEM_MINIMO_HEADERS.map(({ header }) => [header, 0])),
    };
    downloadWorkbook("modelo_itens_ferramentaria.xlsx", "Itens", [modelo]);
  };

  const importarItensExcel = async (event) => {
    if (!roleCanManageItems(usuarioAtual)) {
      notify("Seu perfil não pode importar itens.", "error");
      return;
    }
    const arquivo = event.target.files?.[0];
    event.target.value = "";
    if (!arquivo) return;

    try {
      const buffer = await arquivo.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
      const headers = new Set(
        rows.flatMap((row) => Object.keys(row).map((key) => normalizeHeaderKey(key)))
      );

      const possuiCodigo = headers.has(normalizeHeaderKey(ITEM_HEADER_CODIGO));
      const possuiNome = headers.has(normalizeHeaderKey(ITEM_HEADER_NOME));
      if (!possuiCodigo || !possuiNome) {
        notify(
          "Planilha fora do padrão. Use o modelo de itens (colunas obrigatórias: CODIGO e NOME).",
          "error"
        );
        return;
      }

      const sheetHasQtdMdu = headers.has(normalizeHeaderKey(ITEM_HEADER_QTD_KIT_MDU));
      const sheetHasQtdInst = headers.has(normalizeHeaderKey(ITEM_HEADER_QTD_KIT_INST));

      const payload = rows
        .filter(
          (row) =>
            String(readExcelValue(row, [ITEM_HEADER_CODIGO, "codigo"])).trim() &&
            String(readExcelValue(row, [ITEM_HEADER_NOME, "nome"])).trim()
        )
        .map((row) => {
          const legacyQ = Number(readExcelValue(row, [ITEM_HEADER_QTD_KIT, "qtd_kit", "qtdkit", "qtdKit"]) || 0);
          let qtd_kit_mdu;
          let qtd_kit_inst;
          if (sheetHasQtdMdu || sheetHasQtdInst) {
            qtd_kit_mdu = sheetHasQtdMdu
              ? Number(readExcelValue(row, [ITEM_HEADER_QTD_KIT_MDU, "qtd_kit_mdu", "qtdkitmdu"]) || 0)
              : legacyQ;
            qtd_kit_inst = sheetHasQtdInst
              ? Number(readExcelValue(row, [ITEM_HEADER_QTD_KIT_INST, "qtd_kit_inst", "qtdkitinst"]) || 0)
              : legacyQ;
          } else {
            qtd_kit_mdu = legacyQ;
            qtd_kit_inst = legacyQ;
          }
          return {
            codigo: String(readExcelValue(row, [ITEM_HEADER_CODIGO, "codigo"])).trim(),
            nome: String(readExcelValue(row, [ITEM_HEADER_NOME, "nome"])).trim(),
            valor: Number(readExcelValue(row, [ITEM_HEADER_VALOR, "valor"]) || 0),
            qtd_kit_mdu,
            qtd_kit_inst,
            minimos: Object.fromEntries(
              ITEM_MINIMO_HEADERS.map(({ cc, header }) => [
                cc,
                Number(readExcelValue(row, [header, cc, `MINIMO_${cc}`, `minimo_${cc}`]) || 0),
              ])
            ),
          };
        });

      if (!payload.length) {
        notify("Nenhuma linha válida encontrada na planilha.", "error");
        return;
      }

      const porCodigo = new Map();
      for (const row of payload) {
        porCodigo.set(row.codigo, row);
      }
      const unicos = [...porCodigo.values()];
      const codigos = unicos.map((r) => r.codigo);
      const { data: existentes, error: selErr } = await supabase
        .from("itens")
        .select("id,codigo")
        .in("codigo", codigos);
      if (selErr) throw selErr;
      const idPorCodigo = Object.fromEntries((existentes || []).map((r) => [r.codigo, r.id]));
      const inserir = [];
      const atualizar = [];
      for (const row of unicos) {
        const reg = {
          codigo: row.codigo,
          nome: row.nome,
          valor: row.valor,
          qtd_kit_mdu: row.qtd_kit_mdu,
          qtd_kit_inst: row.qtd_kit_inst,
          minimos: row.minimos,
        };
        const id = idPorCodigo[row.codigo];
        if (id) atualizar.push({ id, ...reg });
        else inserir.push(reg);
      }
      for (const row of atualizar) {
        const { id, ...rest } = row;
        const { error: upErr } = await supabase.from("itens").update(rest).eq("id", id);
        if (upErr) throw upErr;
      }
      if (inserir.length) {
        const { error: insErr } = await supabase.from("itens").insert(inserir);
        if (insErr) throw insErr;
      }
      await buscarItens();
      notify(`${atualizar.length} item(ns) atualizado(s), ${inserir.length} novo(s).`, "success");
    } catch (error) {
      console.error(error);
      captureException(error, { op: "importarItensExcel" });
      notify(getSupabaseErrorMessage(error, "Erro ao importar planilha de itens."), "error");
    }
  };

  const cadastrarTecnico = async () => {
    if (!roleCanCreateCadastrosTecnicos(usuarioAtual, tecnicoForm.cc)) {
      alert("Seu perfil não pode cadastrar técnicos nesse CC.");
      return;
    }
    if (!tecnicoForm.nome.trim() || !tecnicoForm.cc) {
      alert("Preencha o nome e o centro de custo.");
      return;
    }
    const { error } = await supabase.from("tecnicos").insert([{ nome: tecnicoForm.nome.trim(), cc: tecnicoForm.cc }]);
    if (error) {
      console.error(error);
      alert("Erro ao salvar técnico.");
      return;
    }
    await buscarTecnicos();
    setTecnicoForm(emptyTecnicoForm());
  };

  const excluirTecnico = async (id) => {
    const tecnico = tecnicosById[Number(id)];
    if (!tecnico || !roleCanCreateCadastrosTecnicos(usuarioAtual, tecnico.cc)) {
      alert("Seu perfil não pode excluir este técnico.");
      return;
    }
    const possuiMovimentacao = movimentacoes.some((mov) => Number(mov.tecnico_id) === Number(id));
    if (possuiMovimentacao) {
      alert("Este técnico já possui movimentações vinculadas.");
      return;
    }
    const { error } = await supabase.from("tecnicos").delete().eq("id", id);
    if (error) {
      console.error(error);
      alert("Erro ao excluir técnico.");
      return;
    }
    await buscarTecnicos();
  };

  const salvarEdicaoTecnico = async () => {
    if (!tecnicoEditandoId) return;
    const alvo = tecnicosById[Number(tecnicoEditandoId)];
    if (!alvo) return;
    if (!roleCanCreateCadastrosTecnicos(usuarioAtual, alvo.cc)) {
      alert("Seu perfil não pode editar este técnico.");
      return;
    }
    const nome = String(tecnicoEdicaoDraft.nome || "").trim();
    const cc = String(tecnicoEdicaoDraft.cc || "").trim();
    if (!nome || !cc) {
      alert("Preencha o nome e o centro de custo.");
      return;
    }
    if (!roleCanCreateCadastrosTecnicos(usuarioAtual, cc)) {
      alert("Seu perfil não pode atribuir técnicos ao CC selecionado.");
      return;
    }
    const { error } = await supabase.from("tecnicos").update({ nome, cc }).eq("id", tecnicoEditandoId);
    if (error) {
      console.error(error);
      alert(getSupabaseErrorMessage(error, "Erro ao atualizar técnico."));
      return;
    }
    await buscarTecnicos();
    setTecnicoEditandoId(null);
    setTecnicoEdicaoDraft({ nome: "", cc: "" });
  };

  const exportarTecnicosExcel = () => {
    const rows = tecnicos
      .filter((tec) => roleCanViewCC(usuarioAtual, tec.cc))
      .map((tec) => ({ [TECNICO_HEADER_NOME]: tec.nome, [TECNICO_HEADER_CC]: tec.cc }));
    downloadWorkbook("tecnicos_ferramentaria.xlsx", "Tecnicos", rows);
  };

  const baixarModeloTecnicosExcel = () => {
    downloadWorkbook("modelo_tecnicos_ferramentaria.xlsx", "Tecnicos", [
      { [TECNICO_HEADER_NOME]: "", [TECNICO_HEADER_CC]: "" },
    ]);
  };

  const importarTecnicosExcel = async (event) => {
    const arquivo = event.target.files?.[0];
    event.target.value = "";
    if (!arquivo) return;

    try {
      const buffer = await arquivo.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
      const headers = new Set(
        rows.flatMap((row) => Object.keys(row).map((key) => normalizeHeaderKey(key)))
      );
      const possuiNome = headers.has(normalizeHeaderKey(TECNICO_HEADER_NOME));
      const possuiCC = headers.has(normalizeHeaderKey(TECNICO_HEADER_CC));
      if (!possuiNome || !possuiCC) {
        alert("Planilha fora do padrão. Use o modelo de técnicos (colunas obrigatórias: NOME e CC).");
        return;
      }

      const payload = rows
        .map((row) => ({
          nome: String(readExcelValue(row, [TECNICO_HEADER_NOME, "nome"])).trim(),
          cc: String(readExcelValue(row, [TECNICO_HEADER_CC, "cc"])).trim(),
        }))
        .filter((row) => row.nome && row.cc && roleCanCreateCadastrosTecnicos(usuarioAtual, row.cc));

      if (!payload.length) {
        alert("Nenhuma linha válida encontrada para importação.");
        return;
      }

      const { error } = await supabase.from("tecnicos").insert(payload);
      if (error) throw error;
      await buscarTecnicos();
      alert(`${payload.length} técnico(s) importado(s) com sucesso.`);
    } catch (error) {
      console.error(error);
      alert("Erro ao importar planilha de técnicos.");
    }
  };

  const validarLinhaMovimentacao = (linha) => {
    if (!linha.tipo || !linha.item_id || !linha.cc || !linha.quantidade) {
      return "Preencha tipo, item, CC e quantidade.";
    }

    if (!roleCanManageCC(usuarioAtual, linha.cc)) {
      return "Seu perfil não pode movimentar estoque neste CC.";
    }

    const quantidade = Number(linha.quantidade || 0);
    if (!Number.isFinite(quantidade) || quantidade <= 0) {
      return "Informe uma quantidade válida maior que zero.";
    }

    const exigeTecnico = [
      "saida_tecnico",
      "devolucao_tecnico",
      "substituicao_perda",
      "substituicao_quebra",
      "substituicao_desgaste",
    ].includes(linha.tipo);

    if (exigeTecnico && !linha.tecnico_id) {
      return "Selecione o técnico para este tipo de movimentação.";
    }

    const tecnico = tecnicosById[Number(linha.tecnico_id)];
    if (exigeTecnico && tecnico && tecnico.cc !== linha.cc) {
      return "O técnico selecionado não pertence ao CC informado.";
    }

    const itemId = Number(linha.item_id);
    const tecnicoId = linha.tecnico_id ? Number(linha.tecnico_id) : null;
    const chaveEstoque = `${linha.cc}-${itemId}`;
    const chaveTecnico = tecnicoId ? `${tecnicoId}-${itemId}` : null;
    const saldoAtualEstoque = Number(saldoEstoqueCCItem[chaveEstoque] || 0);
    const saldoAtualTecnico = chaveTecnico ? Number(saldoTecnicoItem[chaveTecnico] || 0) : 0;

    if (["saida_tecnico", "ajuste_negativo"].includes(linha.tipo) && quantidade > saldoAtualEstoque) {
      return `Saldo insuficiente no estoque. Saldo atual: ${saldoAtualEstoque}.`;
    }

    if (["substituicao_perda", "substituicao_quebra", "substituicao_desgaste"].includes(linha.tipo)) {
      if (quantidade > saldoAtualEstoque) {
        return `Saldo insuficiente no estoque para substituição. Saldo atual: ${saldoAtualEstoque}.`;
      }
      if (quantidade > saldoAtualTecnico) {
        return `O técnico não possui essa quantidade do item. Saldo com técnico: ${saldoAtualTecnico}.`;
      }
    }

    if (linha.tipo === "devolucao_tecnico" && quantidade > saldoAtualTecnico) {
      return `O técnico não possui essa quantidade para devolver. Saldo com técnico: ${saldoAtualTecnico}.`;
    }

    return null;
  };

  const adicionarAoLote = () => {
    const erro = validarLinhaMovimentacao(movForm);
    if (erro) {
      notify(erro, "error");
      return;
    }

    setLoteMovimentacoes((prev) => [...prev, { ...movForm, localId: uid() }]);
    setMovForm((prev) => ({ ...emptyMovForm(), cc: prev.cc }));
    setMovBuscaItem("");
    setMovBuscaTecnico("");
  };

  const removerDoLote = (localId) => {
    setLoteMovimentacoes((prev) => prev.filter((item) => item.localId !== localId));
  };

  const limparLoteMovimentacoes = () => {
    setLoteMovimentacoes([]);
  };

  const validarLinhaTriangulacao = (linha) => {
    if (!canRequestTriangulacao(usuarioAtual)) {
      return "Seu usuário não possui permissão para solicitar triangulação.";
    }
    if (!linha.cc_origem || !linha.cc_destino || !linha.item_id || !linha.quantidade) {
      return "Preencha origem, destino, item e quantidade.";
    }
    if (linha.cc_origem === linha.cc_destino) {
      return "Origem e destino não podem ser iguais.";
    }
    if (!roleCanManageCC(usuarioAtual, linha.cc_origem)) {
      return "Seu perfil não pode solicitar triangulação a partir desse CC.";
    }

    const quantidade = Number(linha.quantidade || 0);
    const itemId = Number(linha.item_id);
    const saldoAtual = Number(saldoEstoqueCCItem[`${linha.cc_origem}-${itemId}`] || 0);
    if (!Number.isFinite(quantidade) || quantidade <= 0) {
      return "Informe uma quantidade válida.";
    }
    if (quantidade > saldoAtual) {
      return `Saldo insuficiente na origem. Saldo atual: ${saldoAtual}.`;
    }
    return null;
  };

  const adicionarTriangulacaoAoLote = () => {
    const erro = validarLinhaTriangulacao(triForm);
    if (erro) {
      notify(erro, "error");
      return;
    }
    setLoteTriangulacoes((prev) => [...prev, { ...triForm, localId: uid() }]);
    setTriForm((prev) => ({ ...emptyTriForm(), cc_origem: prev.cc_origem, cc_destino: prev.cc_destino }));
  };

  const removerTriangulacaoDoLote = (localId) => {
    setLoteTriangulacoes((prev) => prev.filter((linha) => linha.localId !== localId));
  };

  const limparLoteTriangulacoes = () => {
    setLoteTriangulacoes([]);
  };

  const salvarLoteMovimentacoes = async () => {
    if (!loteMovimentacoes.length) {
      notify("Adicione ao menos uma linha no lote antes de salvar.", "error");
      return;
    }

    const linhasCobranca = loteMovimentacoes.filter((linha) => ["substituicao_perda", "substituicao_quebra"].includes(linha.tipo));
    if (linhasCobranca.length) {
      const itensTexto = linhasCobranca
        .map((linha) => {
          const item = itensById[Number(linha.item_id)];
          return `${item?.nome || "Item"} x${linha.quantidade} (${LABEL_TIPO[linha.tipo]})`;
        })
        .join("\n");
      const confirmou = window.confirm(
        `Atenção: esta movimentação possui itens que exigem gerar desconto/cobrança:\n\n${itensTexto}\n\nDeseja continuar?`
      );
      if (!confirmou) return;
    }

    const payload = loteMovimentacoes.map((linha) => ({
      tipo: linha.tipo,
      item_id: Number(linha.item_id),
      tecnico_id: linha.tecnico_id ? Number(linha.tecnico_id) : null,
      cc: linha.cc,
      quantidade: Number(linha.quantidade),
      observacao: linha.observacao?.trim() || null,
    }));

    const { error, salvouAutor } = await insertMovimentacoesComAutor(payload, usuarioAtual);
    if (error) {
      console.error(error);
      captureException(error, { op: "salvarLoteMovimentacoes" });
      notify(getSupabaseErrorMessage(error, "Erro ao salvar movimentações."), "error");
      return;
    }

    await buscarMovimentacoes();
    setLoteMovimentacoes([]);
    setMovForm(emptyMovForm());
    setMovBuscaItem("");
    setMovBuscaTecnico("");
    if (!salvouAutor) {
      notify("Movimentações salvas, mas seu banco ainda não possui colunas de autor. Rode a migração para exibir o nome no histórico.", "warning");
      return;
    }
    notify("Movimentações salvas com sucesso.", "success");
  };

  const solicitarTriangulacao = async () => {
    if (!loteTriangulacoes.length) {
      notify("Adicione ao menos uma triangulação ao lote antes de solicitar.", "error");
      return;
    }

    const erros = loteTriangulacoes
      .map((linha) => validarLinhaTriangulacao(linha))
      .filter(Boolean);
    if (erros.length) {
      notify(erros[0], "error");
      return;
    }

    const totaisOrigemItem = {};
    loteTriangulacoes.forEach((linha) => {
      const chave = `${linha.cc_origem}-${Number(linha.item_id)}`;
      totaisOrigemItem[chave] = Number(totaisOrigemItem[chave] || 0) + Number(linha.quantidade || 0);
    });
    const conflitoSaldo = Object.entries(totaisOrigemItem).find(([chave, qtdSolicitada]) => {
      const saldoAtual = Number(saldoEstoqueCCItem[chave] || 0);
      return Number(qtdSolicitada) > saldoAtual;
    });
    if (conflitoSaldo) {
      const [chave, qtdSolicitada] = conflitoSaldo;
      const saldoAtual = Number(saldoEstoqueCCItem[chave] || 0);
      notify(
        `Saldo insuficiente para o lote em ${chave.replace("-", " / ")}. Solicitado: ${qtdSolicitada}. Saldo atual: ${saldoAtual}.`,
        "error"
      );
      return;
    }

    const agoraIso = new Date().toISOString();
    const registros = loteTriangulacoes.map((linha) => ({
      id: uid(),
      cc_origem: linha.cc_origem,
      cc_destino: linha.cc_destino,
      item_id: Number(linha.item_id),
      quantidade: Number(linha.quantidade || 0),
      observacao: String(linha.observacao || "").trim(),
      solicitado_por: usuarioAtual?.usuario || "-",
      solicitado_nome: usuarioAtual?.nome || "-",
      status: "Pendente",
      created_at: agoraIso,
    }));

    const { error } = await supabase.from("triangulacoes").insert(registros.map((registro) => triRegistroToDbRow(registro)));
    if (error) {
      console.error(error);
      captureException(error, { op: "solicitarTriangulacao" });
      notify(getSupabaseErrorMessage(error, "Erro ao registrar triangulação."), "error");
      return;
    }
    setTriForm(emptyTriForm());
    setLoteTriangulacoes([]);
    await buscarTriangulacoes();
    notify("Triangulações solicitadas com sucesso. Aguarde aprovação para movimentar o estoque.", "success");
  };

  const aprovarTriangulacao = async (tri) => {
    if (!roleCanApproveTriangulacao(usuarioAtual, tri.cc_origem, tri.cc_destino)) {
      notify("Seu perfil não pode aprovar essa triangulação.", "error");
      return;
    }

    const saldoAtual = Number(saldoEstoqueCCItem[`${tri.cc_origem}-${tri.item_id}`] || 0);
    if (Number(tri.quantidade) > saldoAtual) {
      notify(`Saldo insuficiente na origem no momento da aprovação. Saldo atual: ${saldoAtual}.`, "error");
      return;
    }

    const payload = [
      {
        tipo: "triangulacao_saida",
        item_id: Number(tri.item_id),
        tecnico_id: null,
        cc: tri.cc_origem,
        quantidade: Number(tri.quantidade),
        observacao: `Triangulação para ${tri.cc_destino}. ${tri.observacao || ""}`.trim(),
      },
      {
        tipo: "triangulacao_entrada",
        item_id: Number(tri.item_id),
        tecnico_id: null,
        cc: tri.cc_destino,
        quantidade: Number(tri.quantidade),
        observacao: `Triangulação vinda de ${tri.cc_origem}. ${tri.observacao || ""}`.trim(),
      },
    ];

    const { error, salvouAutor } = await insertMovimentacoesComAutor(payload, usuarioAtual);
    if (error) {
      console.error(error);
      captureException(error, { op: "aprovarTriangulacao_mov" });
      notify(getSupabaseErrorMessage(error, "Erro ao aprovar triangulação (movimentações)."), "error");
      return;
    }

    const { error: updErr } = await supabase
      .from("triangulacoes")
      .update({
        status: "Aprovada",
        aprovado_por: usuarioAtual?.usuario || "-",
        aprovado_nome: usuarioAtual?.nome || "-",
        approved_at: new Date().toISOString(),
      })
      .eq("id", tri.id);
    if (updErr) {
      console.error(updErr);
      captureException(updErr, { op: "aprovarTriangulacao_update", tri_id: tri.id });
      notify(
        "Movimentações gravadas, mas falhou ao atualizar o status da solicitação. Informe o suporte.",
        "error"
      );
    } else {
      notify("Triangulação aprovada.", "success");
      if (!salvouAutor) {
        notify("Movimentações da triangulação foram salvas sem o nome do autor (migração pendente no banco).", "warning");
      }
    }
    await buscarTriangulacoes();
    await buscarMovimentacoes();
  };

  const reprovarTriangulacao = async (tri) => {
    if (!roleCanApproveTriangulacao(usuarioAtual, tri.cc_origem, tri.cc_destino)) {
      notify("Seu perfil não pode reprovar essa triangulação.", "error");
      return;
    }
    const { error } = await supabase
      .from("triangulacoes")
      .update({
        status: "Reprovada",
        aprovado_por: usuarioAtual?.usuario || "-",
        aprovado_nome: usuarioAtual?.nome || "-",
        approved_at: new Date().toISOString(),
      })
      .eq("id", tri.id);
    if (error) {
      console.error(error);
      notify(getSupabaseErrorMessage(error, "Erro ao reprovar triangulação."), "error");
      return;
    }
    await buscarTriangulacoes();
    notify("Triangulação reprovada.", "success");
  };

  const cadastrarUsuario = async () => {
    if (!roleCanManageUsers(usuarioAtual)) {
      alert("Seu perfil não pode cadastrar usuários.");
      return;
    }
    if (!usuarioForm.nome.trim() || !usuarioForm.usuario.trim() || !usuarioForm.cargo) {
      alert("Preencha nome, usuário e cargo.");
      return;
    }
    if (usuariosSistema.some((u) => u.usuario === usuarioForm.usuario.trim())) {
      alert("Já existe um usuário com esse login.");
      return;
    }

    if (usuarioForm.senha.trim()) {
      const erroSenha = validarPoliticaSenha(usuarioForm.senha);
      if (erroSenha) {
        alert(`Senha informada inválida: ${erroSenha}`);
        return;
      }
    }

    const senhaInicial = usuarioForm.senha.trim() || DEFAULT_USER_PASSWORD;
    const usarSenhaPadrao = !usuarioForm.senha.trim();

    const novo = normalizeUser({
      id: uid(),
      nome: usuarioForm.nome.trim(),
      usuario: usuarioForm.usuario.trim(),
      senha: senhaInicial,
      cargo: usuarioForm.cargo,
      ccs:
        usuarioForm.cargo === "Admin" ||
        usuarioForm.cargo === "Gerente" ||
        usuarioForm.cargo === "SUP. Almoxarifado"
          ? [...CCS]
          : [...usuarioForm.ccs],
      permissions: {
        ...getDefaultPermissions(usuarioForm.cargo),
        ...(usuarioForm.permissions || {}),
      },
      ativo: true,
      mustChangePassword: usarSenhaPadrao,
    });
    const { error } = await supabase.from("usuarios").insert([toDbUserPayload(novo)]);
    if (error) {
      alert(getSupabaseErrorMessage(error, "Erro ao cadastrar usuário no banco."));
      return;
    }
    setUsuariosSistema((prev) => [novo, ...prev.map((user) => normalizeUser(user))]);
    setUsuarioForm({
      nome: "",
      usuario: "",
      senha: "",
      cargo: "Gerente",
      ccs: [...CCS],
      ativo: true,
      permissions: getDefaultPermissions("Gerente"),
    });
    alert(
      usarSenhaPadrao
        ? `Usuário criado com senha padrão (${DEFAULT_USER_PASSWORD}). No primeiro acesso será obrigatório trocar a senha.`
        : "Usuário criado com sucesso."
    );
  };

  const alternarUsuarioAtivo = async (id) => {
    if (!roleCanManageUsers(usuarioAtual)) return;
    const alvo = usuariosSistema.find((u) => u.id === id);
    if (!alvo) return;
    const novoAtivo = alvo.ativo === false;
    const { error } = await supabase.from("usuarios").update({ ativo: novoAtivo }).eq("id", id);
    if (error) {
      alert(getSupabaseErrorMessage(error, "Erro ao atualizar status do usuário."));
      return;
    }
    setUsuariosSistema((prev) =>
      prev.map((u) => (u.id === id ? { ...normalizeUser(u), ativo: !u.ativo } : normalizeUser(u)))
    );
  };

  const excluirUsuario = async (id) => {
    if (!roleCanManageUsers(usuarioAtual)) return;
    const alvo = usuariosSistema.find((u) => u.id === id);
    if (!alvo) return;

    if (String(usuarioAtual?.id) === String(id)) {
      alert("Você não pode excluir o usuário que está logado.");
      return;
    }

    if (alvo.cargo === "Admin") {
      const totalAdmins = usuariosSistema.filter((u) => u.cargo === "Admin" && u.ativo !== false).length;
      if (totalAdmins <= 1) {
        alert("Não é possível excluir o último Admin ativo do sistema.");
        return;
      }
    }

    const confirmou = window.confirm(`Deseja realmente excluir o usuário "${alvo.nome}"?`);
    if (!confirmou) return;

    const { error } = await supabase.from("usuarios").delete().eq("id", id);
    if (error) {
      alert(getSupabaseErrorMessage(error, "Erro ao excluir usuário no banco."));
      return;
    }
    setUsuariosSistema((prev) => prev.filter((u) => u.id !== id).map((user) => normalizeUser(user)));
    setUsuarioExpandidoId((prev) => (prev === id ? null : prev));
  };

  const resetarSenhaUsuario = async (id) => {
    if (!roleCanManageUsers(usuarioAtual)) return;
    const alvo = usuariosSistema.find((u) => u.id === id);
    if (!alvo) return;
    const confirmou = window.confirm(
      `Deseja resetar a senha do usuário "${alvo.nome}" para a senha padrão (${DEFAULT_USER_PASSWORD})?`
    );
    if (!confirmou) return;

    const { error } = await supabase
      .from("usuarios")
      .update({
        senha: DEFAULT_USER_PASSWORD,
        must_change_password: true,
      })
      .eq("id", id);
    if (error) {
      alert(getSupabaseErrorMessage(error, "Erro ao resetar senha no banco."));
      return;
    }

    setUsuariosSistema((prev) =>
      prev.map((u) =>
        u.id === id
          ? normalizeUser({ ...u, senha: DEFAULT_USER_PASSWORD, mustChangePassword: true })
          : normalizeUser(u)
      )
    );

    if (String(usuarioAtual?.id) === String(id)) {
      const usuarioAtualizado = normalizeUser({
        ...usuarioAtual,
        senha: DEFAULT_USER_PASSWORD,
        mustChangePassword: true,
      });
      setUsuarioAtual(usuarioAtualizado);
      safeLocalStorageSet(STORAGE_KEY_AUTH, usuarioAtualizado);
    }

    alert("Senha resetada. No próximo acesso será obrigatório definir uma senha pessoal.");
  };

  const atualizarUsuarioCC = async (id, cc, checked) => {
    if (!roleCanManageUsers(usuarioAtual)) return;
    const alvo = usuariosSistema.find((user) => user.id === id);
    if (!alvo) return;
    const normalizado = normalizeUser(alvo);
    const ccsAtualizados = ["Admin", "Gerente", "SUP. Almoxarifado"].includes(normalizado.cargo)
      ? [...CCS]
      : checked
        ? Array.from(new Set([...(normalizado.ccs || []), cc]))
        : (normalizado.ccs || []).filter((item) => item !== cc);
    const { error } = await supabase.from("usuarios").update({ ccs: ccsAtualizados }).eq("id", id);
    if (error) {
      alert(getSupabaseErrorMessage(error, "Erro ao atualizar CCs do usuário."));
      return;
    }
    setUsuariosSistema((prev) =>
      prev.map((user) => {
        if (user.id !== id) return normalizeUser(user);
        const normalizado = normalizeUser(user);
        if (["Admin", "Gerente", "SUP. Almoxarifado"].includes(normalizado.cargo)) {
          return { ...normalizado, ccs: [...CCS] };
        }
        return {
          ...normalizado,
          ccs: checked
            ? Array.from(new Set([...(normalizado.ccs || []), cc]))
            : (normalizado.ccs || []).filter((item) => item !== cc),
        };
      })
    );
  };

  const atualizarUsuarioPermissao = async (id, key, checked) => {
    if (!roleCanManageUsers(usuarioAtual)) return;
    const alvo = usuariosSistema.find((user) => user.id === id);
    if (!alvo) return;
    const permissoesAtualizadas = {
      ...normalizeUser(alvo).permissions,
      [key]: checked,
    };
    const { error } = await supabase
      .from("usuarios")
      .update({ permissions: permissoesAtualizadas })
      .eq("id", id);
    if (error) {
      alert(getSupabaseErrorMessage(error, "Erro ao atualizar permissões do usuário."));
      return;
    }
    setUsuariosSistema((prev) =>
      prev.map((user) =>
        user.id === id
          ? {
              ...normalizeUser(user),
              permissions: {
                ...normalizeUser(user).permissions,
                [key]: checked,
              },
            }
          : normalizeUser(user)
      )
    );
  };

  const itensOrdenados = useMemo(
    () =>
      [...itens].sort((a, b) =>
        String(a?.nome || "").localeCompare(String(b?.nome || ""), "pt-BR")
      ),
    [itens]
  );

  const itensFiltrados = useMemo(() => {
    const termo = String(buscaItem || "").trim().toLowerCase();
    if (!termo) return itensOrdenados;
    return itensOrdenados.filter((item) => {
      const nome = String(item?.nome || "").toLowerCase();
      const codigo = String(item?.codigo || "").toLowerCase();
      return nome.includes(termo) || codigo.includes(termo);
    });
  }, [itensOrdenados, buscaItem]);

  const opcoesItemMovimentacao = useMemo(
    () =>
      itensOrdenados.map((item) => ({
        id: String(item.id),
        label: `${item.nome} (${item.codigo})`,
      })),
    [itensOrdenados]
  );

  const opcoesItemMovimentacaoFiltradas = useMemo(() => {
    const termo = String(movBuscaItem || "").trim().toLowerCase();
    if (!termo) return opcoesItemMovimentacao.slice(0, 80);
    return opcoesItemMovimentacao
      .filter((opt) => opt.label.toLowerCase().includes(termo))
      .slice(0, 80);
  }, [opcoesItemMovimentacao, movBuscaItem]);

  const usuariosVisiveis = useMemo(
    () =>
      usuariosSistema
        .map((user) => normalizeUser(user))
        .filter((user) => !isHiddenFromUsersScreen(user))
        .sort((a, b) => String(a?.nome || "").localeCompare(String(b?.nome || ""), "pt-BR")),
    [usuariosSistema]
  );
  const usuariosFiltrados = useMemo(() => {
    const termo = String(buscaUsuario || "").trim().toLowerCase();
    if (!termo) return usuariosVisiveis;
    return usuariosVisiveis.filter((user) => {
      const nome = String(user?.nome || "").toLowerCase();
      const login = String(user?.usuario || "").toLowerCase();
      return nome.includes(termo) || login.includes(termo);
    });
  }, [usuariosVisiveis, buscaUsuario]);

  const tecnicosVisiveis = useMemo(
    () => tecnicos.filter((tec) => roleCanViewCC(usuarioAtual, tec.cc)),
    [tecnicos, usuarioAtual]
  );

  const tecnicosFiltrados = useMemo(() => {
    const termo = String(buscaTecnico || "").trim().toLowerCase();
    if (!termo) return tecnicosVisiveis;
    return tecnicosVisiveis.filter((tec) => {
      const nome = String(tec.nome || "").toLowerCase();
      const cc = String(tec.cc || "").toLowerCase();
      return nome.includes(termo) || cc.includes(termo);
    });
  }, [tecnicosVisiveis, buscaTecnico]);

  const opcoesTecnicoMovimentacao = useMemo(
    () =>
      tecnicosVisiveis
        .filter((tec) => !movForm.cc || tec.cc === movForm.cc)
        .sort((a, b) => String(a?.nome || "").localeCompare(String(b?.nome || ""), "pt-BR"))
        .map((tec) => ({
          id: String(tec.id),
          label: `${tec.nome} (${tec.cc})`,
        })),
    [tecnicosVisiveis, movForm.cc]
  );

  const opcoesTecnicoMovimentacaoFiltradas = useMemo(() => {
    const termo = String(movBuscaTecnico || "").trim().toLowerCase();
    if (!termo) return opcoesTecnicoMovimentacao.slice(0, 80);
    return opcoesTecnicoMovimentacao
      .filter((opt) => opt.label.toLowerCase().includes(termo))
      .slice(0, 80);
  }, [opcoesTecnicoMovimentacao, movBuscaTecnico]);

  useEffect(() => {
    setTecnicoEditandoId(null);
  }, [buscaTecnico]);

  const itensCriticosVisiveis = indicadoresDashboard.itensCriticos;

  const exportarRelatorioEstoqueExcel = () => {
    const consolidadoRows = estoqueGeral
      .filter((registro) => roleCanViewCC(usuarioAtual, registro.cc))
      .map((registro) => ({
        CC: registro.cc,
        ITEM_ID: Number(registro.itemId),
        ITEM: registro.itemNome,
        NO_ESTOQUE: Number(registro.estoque || 0),
        COM_TECNICOS: Number(registro.comTecnico || 0),
        TOTAL: Number(registro.total || 0),
        MINIMO: Number(registro.minimo || 0),
      }));

    const tecnicoRows = estoquePorTecnico
      .filter((registro) => roleCanViewCC(usuarioAtual, registro.cc))
      .map((registro) => ({
        CC: registro.cc,
        TECNICO_ID: Number(registro.tecnico_id),
        TECNICO: registro.tecnicoNome,
        ITEM_ID: Number(registro.item_id),
        ITEM: registro.itemNome,
        QUANTIDADE: Number(registro.quantidade || 0),
      }));

    downloadWorkbookSheets("relatorio_estoque_completo.xlsx", [
      {
        name: "Consolidado_CC_Item",
        rows: consolidadoRows.length ? consolidadoRows : [{ INFO: "Sem dados para exportar." }],
      },
      {
        name: "Com_Tecnicos",
        rows: tecnicoRows.length ? tecnicoRows : [{ INFO: "Sem dados para exportar." }],
      },
    ]);
  };

  const estoqueConsolidadoFiltrado = useMemo(() => {
    const comTecnicoPorChave = {};
    const termoBusca = normalizeSearchText(estoqueFiltro.busca_nome);

    estoquePorTecnico
      .filter((registro) => {
        if (estoqueFiltro.cc && registro.cc !== estoqueFiltro.cc) return false;
        if (estoqueFiltro.tecnico_id && Number(registro.tecnico_id) !== Number(estoqueFiltro.tecnico_id)) return false;
        if (estoqueFiltro.item_id && Number(registro.item_id) !== Number(estoqueFiltro.item_id)) return false;
        return true;
      })
      .forEach((registro) => {
        const chave = `${registro.cc}-${registro.item_id}`;
        comTecnicoPorChave[chave] = Number(comTecnicoPorChave[chave] || 0) + Number(registro.quantidade || 0);
      });

    const baseFiltrada = estoqueGeral.filter((registro) => {
      if (!roleCanViewCC(usuarioAtual, registro.cc)) return false;
      if (estoqueFiltro.cc && registro.cc !== estoqueFiltro.cc) return false;
      if (estoqueFiltro.item_id && Number(registro.itemId) !== Number(estoqueFiltro.item_id)) return false;
      return true;
    });

    const registrosPorCcItem = baseFiltrada
      .map((registro) => {
        const chave = `${registro.cc}-${registro.itemId}`;
        const comTecnico = estoqueFiltro.tecnico_id
          ? Number(comTecnicoPorChave[chave] || 0)
          : Number(registro.comTecnico || 0);
        return {
          ...registro,
          comTecnico,
          total: Number(registro.estoque || 0) + comTecnico,
        };
      })
      .filter((registro) => !estoqueFiltro.tecnico_id || registro.comTecnico > 0);

    const consolidadoPorItem = {};
    registrosPorCcItem.forEach((registro) => {
      const chaveItem = Number(registro.itemId);
      if (!consolidadoPorItem[chaveItem]) {
        consolidadoPorItem[chaveItem] = {
          itemId: chaveItem,
          itemNome: registro.itemNome,
          estoque: 0,
          comTecnico: 0,
          total: 0,
          minimo: 0,
        };
      }
      consolidadoPorItem[chaveItem].estoque += Number(registro.estoque || 0);
      consolidadoPorItem[chaveItem].comTecnico += Number(registro.comTecnico || 0);
      consolidadoPorItem[chaveItem].total += Number(registro.total || 0);
      consolidadoPorItem[chaveItem].minimo += Number(registro.minimo || 0);
    });

    const itensElegiveis = itens.filter((item) =>
      !estoqueFiltro.item_id || Number(item.id) === Number(estoqueFiltro.item_id)
    );
    itensElegiveis.forEach((item) => {
      const itemId = Number(item.id);
      if (!consolidadoPorItem[itemId]) {
        consolidadoPorItem[itemId] = {
          itemId,
          itemNome: item.nome,
          estoque: 0,
          comTecnico: 0,
          total: 0,
          minimo: 0,
        };
      }
    });

    return Object.values(consolidadoPorItem)
      .filter((registro) => !termoBusca || normalizeSearchText(registro.itemNome).includes(termoBusca))
      .filter((registro) => mostrarItensZerados || Number(registro.total || 0) > 0)
      .sort((a, b) => a.itemNome.localeCompare(b.itemNome, "pt-BR"));
  }, [estoqueGeral, estoquePorTecnico, estoqueFiltro, usuarioAtual, itens, mostrarItensZerados]);

  if (!usuarioAtual) {
    return (
      <>
        <ToastStack toasts={toasts} />
        <div style={styles.loginBg}>
        <form
          style={styles.loginCard}
          onSubmit={(e) => {
            e.preventDefault();
            login();
          }}
        >
          <div style={styles.brandRow}>
            <img
              src={BRAND_LOGO_SRC}
              alt="Logo EQS Engenharia"
              style={styles.brandLogo}
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
            <div>
              <div style={styles.loginBadge}>Controle de estoque</div>
              <h1 style={styles.loginTitle}>Ferramentaria NET PR</h1>
            </div>
          </div>
          <p style={styles.loginText}>Entre com seu usuário para acessar o painel.</p>
          {erroUsuarios && <p style={styles.warningText}>{erroUsuarios}</p>}
          {carregandoUsuarios && <p style={styles.mutedText}>Carregando usuários...</p>}
          <label style={styles.label} htmlFor="login-usuario">Usuário</label>
          <input
            id="login-usuario"
            style={styles.input}
            name="usuario"
            autoComplete="username"
            value={usuarioLogin}
            onChange={(e) => setUsuarioLogin(e.target.value)}
            placeholder="Digite seu usuário"
          />
          <label style={styles.label} htmlFor="login-senha">Senha</label>
          <input
            id="login-senha"
            style={styles.input}
            name="password"
            type="password"
            autoComplete="current-password"
            value={senhaLogin}
            onChange={(e) => setSenhaLogin(e.target.value)}
            placeholder="Digite sua senha"
          />
          <button type="submit" style={styles.primaryButton}>Entrar</button>
          <p style={styles.loginHint}>Agora também dá para entrar apertando Enter.</p>
        </form>
      </div>
      </>
    );
  }

  if (usuarioAtual?.mustChangePassword) {
    return (
      <>
        <ToastStack toasts={toasts} />
        <div style={styles.loginBg}>
        <form
          style={styles.loginCard}
          onSubmit={(e) => {
            e.preventDefault();
            alterarSenhaObrigatoria();
          }}
        >
          <div style={styles.brandRow}>
            <img
              src={BRAND_LOGO_SRC}
              alt="Logo EQS Engenharia"
              style={styles.brandLogo}
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
            <div>
              <div style={styles.loginBadge}>Primeiro acesso</div>
              <h1 style={styles.loginTitle}>Defina sua senha pessoal</h1>
            </div>
          </div>
          <p style={styles.loginText}>
            Por segurança, você precisa alterar a senha padrão antes de acessar os módulos.
          </p>
          <label style={styles.label} htmlFor="primeiro-acesso-senha">Nova senha</label>
          <input
            id="primeiro-acesso-senha"
            style={styles.input}
            type="password"
            autoComplete="new-password"
            value={novaSenhaObrigatoria}
            onChange={(e) => setNovaSenhaObrigatoria(e.target.value)}
            placeholder="Digite sua nova senha"
          />
          <label style={styles.label} htmlFor="primeiro-acesso-confirma">Confirmar nova senha</label>
          <input
            id="primeiro-acesso-confirma"
            style={styles.input}
            type="password"
            autoComplete="new-password"
            value={confirmarSenhaObrigatoria}
            onChange={(e) => setConfirmarSenhaObrigatoria(e.target.value)}
            placeholder="Repita sua nova senha"
          />
          <button type="submit" style={styles.primaryButton}>Salvar nova senha</button>
        </form>
      </div>
      </>
    );
  }

  return (
    <>
      <ToastStack toasts={toasts} />
    <div style={styles.appShell}>
      <aside style={styles.sidebar}>
        <div style={styles.sidebarHeader}>
          <div style={styles.sidebarBrandRow}>
            <img
              src={BRAND_LOGO_SRC}
              alt="Logo EQS Engenharia"
              style={styles.sidebarLogo}
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
            <div style={styles.sidebarNetPr}>NET PR</div>
          </div>
          <div style={styles.sidebarTitle}>FERRAMENTARIA</div>
        </div>
        <div style={styles.userBox}>
          <div style={styles.userBoxName}>{usuarioAtual.nome}</div>
          <div style={styles.userBoxRole}>{usuarioAtual.cargo}</div>
        </div>
        <nav style={styles.menu}>
          {MENU.filter((item) => item.key !== "usuarios" || roleCanManageUsers(usuarioAtual)).map((item) => (
            <button
              key={item.key}
              onClick={() => setPagina(item.key)}
              style={{ ...styles.menuButton, ...(pagina === item.key ? styles.menuButtonActive : {}) }}
            >
              <span style={styles.menuButtonContent}>
                <MenuIcon iconKey={item.iconKey} />
                <span>{item.label}</span>
              </span>
            </button>
          ))}
        </nav>
      </aside>

      <main style={styles.main}>
        <header style={styles.topbar}>
          <div>
            <h2 style={styles.pageTitle}>{MENU.find((m) => m.key === pagina)?.label || "Sistema"}</h2>
            <div style={styles.topbarSub}>{usuarioAtual.cargo}</div>
          </div>
          <button style={styles.logoutButton} onClick={sair}>Sair</button>
        </header>

        {carregando && <div style={styles.section}>Carregando dados principais...</div>}
        {!carregando && carregandoMovimentacoes && (
          <div style={styles.sectionMini}>Carregando histórico e cálculos de movimentações em segundo plano...</div>
        )}

        {!carregando && pagina === "dashboard" && (
          <>
            {dashboardModo === "criticos-detalhe" ? (
              <div style={styles.section}>
                <div style={styles.sectionHeaderLine}>
                  <h3 style={styles.sectionTitle}>Itens críticos abaixo do mínimo</h3>
                  <button type="button" style={styles.secondaryButtonInline} onClick={() => setDashboardModo("resumo")}>
                    Voltar ao dashboard
                  </button>
                </div>
                <p style={styles.mutedText}>
                  Itens com estoque abaixo do mínimo cadastrado, por centro de custo e item.
                </p>
                <div style={styles.tableWrap}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.th}>CC</th>
                        <th style={styles.th}>Item</th>
                        <th style={styles.th}>Saldo</th>
                        <th style={styles.th}>Mínimo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {itensCriticosVisiveis.length === 0 ? (
                        <tr><td style={styles.td} colSpan={4}>Nenhum item crítico no momento.</td></tr>
                      ) : (
                        itensCriticosVisiveis.map((registro, index) => (
                          <tr key={`${registro.cc}-${registro.itemId}-${index}`}>
                            <td style={styles.td}>{registro.cc}</td>
                            <td style={styles.td}>{registro.itemNome}</td>
                            <td style={{ ...styles.td, color: "#dc2626", fontWeight: 700 }}>{registro.estoque}</td>
                            <td style={styles.td}>{registro.minimo}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <>
            <div style={{ ...styles.section, marginTop: 0, marginBottom: 16 }}>
              <div style={styles.formGrid}>
                <div>
                  <div style={styles.topbarSub}>Filtrar dashboard por centro de custo</div>
                  <select
                    style={styles.input}
                    value={dashboardFiltroCc}
                    onChange={(e) => setDashboardFiltroCc(e.target.value)}
                  >
                    <option value="">Todos os centros de custo</option>
                    {ccsDisponiveisDashboard.map((cc) => (
                      <option key={cc} value={cc}>
                        {cc}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            <div style={styles.cardsGrid}>
              <MetricCard titulo="Técnicos cadastrados" valor={indicadoresDashboard.totalTecnicos} iconKey="tecnicos" />
              <MetricCard titulo="Itens no estoque" valor={indicadoresDashboard.totalNoEstoque} iconKey="estoque" />
              <MetricCard titulo="Itens com técnicos" valor={indicadoresDashboard.totalComTecnicos} iconKey="campo" />
              <MetricCard
                titulo="Itens críticos abaixo do mínimo (clique para ver lista)"
                valor={itensCriticosVisiveis.length}
                destaque
                iconKey="critico"
                onClick={() => setDashboardModo("criticos-detalhe")}
              />
              <MetricCard
                titulo="Kits MDU disponíveis para entrega"
                valor={indicadoresDashboard.totalKitsDisponiveisMdu}
                iconKey="kits"
              />
              <MetricCard
                titulo="Kits INST. disponíveis para entrega"
                valor={indicadoresDashboard.totalKitsDisponiveisInst}
                iconKey="kits"
              />
              <MetricCard
                titulo="Valor de referência KIT MDU (cadastro)"
                valor={
                  canViewDashboardValues(usuarioAtual)
                    ? formatMoney(indicadoresDashboard.valorReferenciaKitsMdu)
                    : "Sem permissão"
                }
                iconKey="money"
              />
              <MetricCard
                titulo="Valor de referência KIT INST. (cadastro)"
                valor={
                  canViewDashboardValues(usuarioAtual)
                    ? formatMoney(indicadoresDashboard.valorReferenciaKitsInst)
                    : "Sem permissão"
                }
                iconKey="money"
              />
              <MetricCard
                titulo="Valor total com técnicos"
                valor={canViewDashboardValues(usuarioAtual) ? formatMoney(indicadoresDashboard.valorTotalComTecnicos) : "Sem permissão"}
                iconKey="money"
              />
              <MetricCard
                titulo="Valor total no estoque"
                valor={canViewDashboardValues(usuarioAtual) ? formatMoney(indicadoresDashboard.valorTotalNoEstoque) : "Sem permissão"}
                iconKey="money"
              />
            </div>
            {!canViewDashboardValues(usuarioAtual) && (
              <p style={{ ...styles.mutedText, marginTop: 10 }}>
                Seu usuário não possui permissão para visualizar valores financeiros no dashboard.
              </p>
            )}

            <div style={styles.section}>
              <div style={styles.dashboardTabsRow}>
                <button
                  style={{
                    ...styles.dashboardTabButton,
                    ...(dashboardAbaAtiva === "criticos" ? styles.dashboardTabButtonActive : {}),
                  }}
                  onClick={() => setDashboardAbaAtiva("criticos")}
                >
                  Itens críticos abaixo do mínimo
                </button>
                <button
                  style={{
                    ...styles.dashboardTabButton,
                    ...(dashboardAbaAtiva === "itens" ? styles.dashboardTabButtonActive : {}),
                  }}
                  onClick={() => setDashboardAbaAtiva("itens")}
                >
                  Top 10 itens substituídos
                </button>
                <button
                  style={{
                    ...styles.dashboardTabButton,
                    ...(dashboardAbaAtiva === "tecnicos" ? styles.dashboardTabButtonActive : {}),
                  }}
                  onClick={() => setDashboardAbaAtiva("tecnicos")}
                >
                  Top 10 técnicos substituidores
                </button>
              </div>

              {dashboardAbaAtiva === "criticos" && (
                <>
                  <h3 style={styles.sectionTitle}>Itens críticos abaixo do mínimo</h3>
                  <div style={styles.tableWrap}>
                    <table style={styles.table}>
                      <thead>
                        <tr>
                          <th style={styles.th}>CC</th>
                          <th style={styles.th}>Item</th>
                          <th style={styles.th}>Saldo</th>
                          <th style={styles.th}>Mínimo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {itensCriticosVisiveis.length === 0 ? (
                          <tr><td style={styles.td} colSpan={4}>Nenhum item crítico no momento.</td></tr>
                        ) : (
                          itensCriticosVisiveis.map((registro, index) => (
                            <tr key={`${registro.cc}-${registro.itemId}-${index}`}>
                              <td style={styles.td}>{registro.cc}</td>
                              <td style={styles.td}>{registro.itemNome}</td>
                              <td style={{ ...styles.td, color: "#dc2626", fontWeight: 700 }}>{registro.estoque}</td>
                              <td style={styles.td}>{registro.minimo}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {dashboardAbaAtiva === "itens" && (
                <>
                  <h3 style={styles.sectionTitle}>Top 10 itens mais substituídos (perda, quebra e desgaste)</h3>
                  {indicadoresDashboard.top10ItensSubstituidos.length === 0 ? (
                    <p style={styles.mutedText}>Ainda não existem substituições lançadas.</p>
                  ) : (
                    <div style={styles.tableWrap}>
                      <table style={styles.table}>
                        <thead>
                          <tr>
                            <th style={styles.th}>Posição</th>
                            <th style={styles.th}>Item</th>
                            <th style={styles.th}>Total</th>
                            <th style={styles.th}>Perda</th>
                            <th style={styles.th}>Quebra</th>
                            <th style={styles.th}>Desgaste</th>
                          </tr>
                        </thead>
                        <tbody>
                          {indicadoresDashboard.top10ItensSubstituidos.map((registro, index) => (
                            <tr key={`${registro.item_id}-${index}`}>
                              <td style={styles.td}>{index + 1}</td>
                              <td style={styles.td}>{registro.itemNome}</td>
                              <td style={styles.td}>{registro.total}</td>
                              <td style={styles.td}>{registro.perda}</td>
                              <td style={styles.td}>{registro.quebra}</td>
                              <td style={styles.td}>{registro.desgaste}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}

              {dashboardAbaAtiva === "tecnicos" && (
                <>
                  <h3 style={styles.sectionTitle}>Top 10 técnicos com mais substituições (perda, quebra e desgaste)</h3>
                  {indicadoresDashboard.top10TecnicosSubstituidores.length === 0 ? (
                    <p style={styles.mutedText}>Ainda não existem substituições vinculadas a técnicos.</p>
                  ) : (
                    <div style={styles.tableWrap}>
                      <table style={styles.table}>
                        <thead>
                          <tr>
                            <th style={styles.th}>Posição</th>
                            <th style={styles.th}>Técnico</th>
                            <th style={styles.th}>CC</th>
                            <th style={styles.th}>Total</th>
                            <th style={styles.th}>Perda</th>
                            <th style={styles.th}>Quebra</th>
                            <th style={styles.th}>Desgaste</th>
                          </tr>
                        </thead>
                        <tbody>
                          {indicadoresDashboard.top10TecnicosSubstituidores.map((registro, index) => (
                            <tr key={`${registro.tecnico_id}-${index}`}>
                              <td style={styles.td}>{index + 1}</td>
                              <td style={styles.td}>{registro.tecnicoNome}</td>
                              <td style={styles.td}>{registro.cc}</td>
                              <td style={styles.td}>{registro.total}</td>
                              <td style={styles.td}>{registro.perda}</td>
                              <td style={styles.td}>{registro.quebra}</td>
                              <td style={styles.td}>{registro.desgaste}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>
              </>
            )}
          </>
        )}

        {!carregando && pagina === "itens" && (
          <div style={styles.section}>
            <div style={styles.sectionHeaderLine}>
              <h3 style={styles.sectionTitle}>Cadastro de itens</h3>
              <div style={styles.actionRow}>
                <button style={styles.secondaryButtonInline} onClick={baixarModeloItensExcel}>Baixar modelo</button>
                <button style={styles.secondaryButtonInline} onClick={exportarItensExcel}>Exportar Excel</button>
                <label style={styles.fileButton}>
                  Importar Excel
                  <input type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={importarItensExcel} />
                </label>
              </div>
            </div>

            {roleCanManageItems(usuarioAtual) ? (
              <>
                <div style={styles.formGrid}>
                  <input style={styles.input} placeholder="Código do item" value={itemForm.codigo} onChange={(e) => setItemForm({ ...itemForm, codigo: e.target.value })} />
                  <input style={styles.input} placeholder="Nome do item" value={itemForm.nome} onChange={(e) => setItemForm({ ...itemForm, nome: e.target.value })} />
                  <input style={styles.input} type="number" placeholder="Valor unitário" value={itemForm.valor} onChange={(e) => setItemForm({ ...itemForm, valor: e.target.value })} />
                  <input
                    style={styles.input}
                    type="number"
                    placeholder="Qtd no KIT MDU (0 = não entra)"
                    value={itemForm.qtdKitMdu}
                    onChange={(e) => setItemForm({ ...itemForm, qtdKitMdu: e.target.value })}
                  />
                  <input
                    style={styles.input}
                    type="number"
                    placeholder="Qtd no KIT INST. (0 = não entra)"
                    value={itemForm.qtdKitInst}
                    onChange={(e) => setItemForm({ ...itemForm, qtdKitInst: e.target.value })}
                  />
                </div>
                <p style={styles.permissionHint}>
                  Informe quantas unidades <strong>deste item</strong> entram em cada tipo de kit. Itens com quantidade zero
                  naquele kit não entram na composição nem no cálculo do dashboard para aquele kit.
                </p>
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
                        onChange={(e) => setItemForm((prev) => ({ ...prev, minimos: { ...prev.minimos, [cc]: e.target.value } }))}
                      />
                    ))}
                  </div>
                </div>
                <button style={styles.primaryButtonInline} onClick={cadastrarItem}>Cadastrar item</button>
              </>
            ) : (
              <p style={styles.mutedText}>Seu perfil pode consultar e exportar, mas não cadastrar itens.</p>
            )}

            <div style={styles.sectionMini}>
              <input
                style={styles.input}
                placeholder="Buscar item por nome ou código"
                value={buscaItem}
                onChange={(e) => setBuscaItem(e.target.value)}
              />
            </div>

            <div style={styles.tableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Código</th>
                    <th style={styles.th}>Nome</th>
                    <th style={styles.th}>Valor</th>
                    <th style={styles.th}>Qtd KIT MDU</th>
                    <th style={styles.th}>Qtd KIT INST.</th>
                    <th style={styles.th}>Mínimos por CC</th>
                    <th style={styles.th}>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {itens.length === 0 ? (
                    <tr><td style={styles.td} colSpan={7}>Nenhum item cadastrado.</td></tr>
                  ) : itensFiltrados.length === 0 ? (
                    <tr><td style={styles.td} colSpan={7}>Nenhum item encontrado para o filtro informado.</td></tr>
                  ) : (
                    itensFiltrados.map((item) =>
                      itemEditandoId === item.id ? (
                        <tr key={item.id}>
                          <td style={styles.td}>
                            <input
                              style={styles.input}
                              value={itemEdicaoDraft.codigo}
                              onChange={(e) => setItemEdicaoDraft((d) => ({ ...d, codigo: e.target.value }))}
                            />
                          </td>
                          <td style={styles.td}>
                            <input
                              style={styles.input}
                              value={itemEdicaoDraft.nome}
                              onChange={(e) => setItemEdicaoDraft((d) => ({ ...d, nome: e.target.value }))}
                            />
                          </td>
                          <td style={styles.td}>
                            <input
                              style={styles.input}
                              type="number"
                              value={itemEdicaoDraft.valor}
                              onChange={(e) => setItemEdicaoDraft((d) => ({ ...d, valor: e.target.value }))}
                            />
                          </td>
                          <td style={styles.td}>
                            <input
                              style={styles.input}
                              type="number"
                              value={itemEdicaoDraft.qtdKitMdu}
                              onChange={(e) => setItemEdicaoDraft((d) => ({ ...d, qtdKitMdu: e.target.value }))}
                            />
                          </td>
                          <td style={styles.td}>
                            <input
                              style={styles.input}
                              type="number"
                              value={itemEdicaoDraft.qtdKitInst}
                              onChange={(e) => setItemEdicaoDraft((d) => ({ ...d, qtdKitInst: e.target.value }))}
                            />
                          </td>
                          <td style={styles.td}>
                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                                gap: 8,
                                maxWidth: 420,
                              }}
                            >
                              {CCS.map((cc) => (
                                <input
                                  key={cc}
                                  style={{ ...styles.input, fontSize: 12 }}
                                  type="number"
                                  title={cc}
                                  placeholder={cc.replace("CC NET ", "")}
                                  value={itemEdicaoDraft.minimos[cc]}
                                  onChange={(e) =>
                                    setItemEdicaoDraft((prev) => ({
                                      ...prev,
                                      minimos: { ...prev.minimos, [cc]: e.target.value },
                                    }))
                                  }
                                />
                              ))}
                            </div>
                          </td>
                          <td style={styles.td}>
                            <div style={styles.actionRow}>
                              <button type="button" style={styles.primaryButtonInline} onClick={salvarEdicaoItem}>
                                Salvar
                              </button>
                              <button type="button" style={styles.secondaryButtonInline} onClick={cancelarEdicaoItem}>
                                Cancelar
                              </button>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        <tr key={item.id}>
                          <td style={styles.td}>{item.codigo}</td>
                          <td style={styles.td}>{item.nome}</td>
                          <td style={styles.td}>{formatMoney(item.valor)}</td>
                          <td style={styles.td}>{item.qtdKitMdu}</td>
                          <td style={styles.td}>{item.qtdKitInst}</td>
                          <td style={styles.td}>
                            <div style={styles.minimosLista}>
                              {CCS.map((cc) => (
                                <div key={cc} style={styles.minimoLinha}>
                                  <strong>{cc}:</strong> {Number(item.minimos?.[cc] || 0)}
                                </div>
                              ))}
                            </div>
                          </td>
                          <td style={styles.td}>
                            {roleCanManageItems(usuarioAtual) ? (
                              <div style={styles.actionRow}>
                                <button
                                  type="button"
                                  style={styles.secondaryButtonInline}
                                  onClick={() => iniciarEdicaoItem(item)}
                                >
                                  Editar
                                </button>
                                <button style={styles.deleteButton} onClick={() => excluirItem(item.id)}>
                                  Excluir
                                </button>
                              </div>
                            ) : (
                              "-"
                            )}
                          </td>
                        </tr>
                      )
                    )
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!carregando && pagina === "tecnicos" && (
          <div style={styles.section}>
            <div style={styles.sectionHeaderLine}>
              <h3 style={styles.sectionTitle}>Cadastro de técnicos</h3>
              <div style={styles.actionRow}>
                <button style={styles.secondaryButtonInline} onClick={baixarModeloTecnicosExcel}>Baixar modelo</button>
                <button style={styles.secondaryButtonInline} onClick={exportarTecnicosExcel}>Exportar Excel</button>
                <label style={styles.fileButton}>
                  Importar Excel
                  <input type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={importarTecnicosExcel} />
                </label>
              </div>
            </div>

            {usuarioAtual.cargo !== "Sup. Técnico" ? (
              <>
                <div style={styles.formGrid}>
                  <input style={styles.input} placeholder="Nome do técnico" value={tecnicoForm.nome} onChange={(e) => setTecnicoForm({ ...tecnicoForm, nome: e.target.value })} />
                  <select style={styles.input} value={tecnicoForm.cc} onChange={(e) => setTecnicoForm({ ...tecnicoForm, cc: e.target.value })}>
                    <option value="">Selecione o centro de custo</option>
                    {CCS.filter((cc) => roleCanManageCC(usuarioAtual, cc) || roleCanViewCC(usuarioAtual, cc)).map((cc) => (
                      <option key={cc} value={cc}>{cc}</option>
                    ))}
                  </select>
                </div>
                <button style={styles.primaryButtonInline} onClick={cadastrarTecnico}>Cadastrar técnico</button>
              </>
            ) : (
              <p style={styles.mutedText}>Seu perfil pode apenas consultar técnicos do próprio CC.</p>
            )}

            <div style={styles.sectionMini}>
              <input
                style={styles.input}
                placeholder="Buscar técnico por nome ou centro de custo"
                value={buscaTecnico}
                onChange={(e) => setBuscaTecnico(e.target.value)}
              />
            </div>

            <div style={styles.tableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Nome</th>
                    <th style={styles.th}>Centro de custo</th>
                    <th style={styles.th}>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {tecnicosVisiveis.length === 0 ? (
                    <tr><td style={styles.td} colSpan={3}>Nenhum técnico cadastrado.</td></tr>
                  ) : tecnicosFiltrados.length === 0 ? (
                    <tr><td style={styles.td} colSpan={3}>Nenhum técnico encontrado para o filtro informado.</td></tr>
                  ) : (
                    tecnicosFiltrados.map((tec) => (
                      <tr key={tec.id}>
                        {tecnicoEditandoId === tec.id ? (
                          <>
                            <td style={styles.td}>
                              <input
                                style={styles.input}
                                value={tecnicoEdicaoDraft.nome}
                                onChange={(e) => setTecnicoEdicaoDraft((d) => ({ ...d, nome: e.target.value }))}
                              />
                            </td>
                            <td style={styles.td}>
                              <select
                                style={styles.input}
                                value={tecnicoEdicaoDraft.cc}
                                onChange={(e) => setTecnicoEdicaoDraft((d) => ({ ...d, cc: e.target.value }))}
                              >
                                <option value="">Selecione o centro de custo</option>
                                {CCS.filter((cc) => roleCanManageCC(usuarioAtual, cc) || roleCanViewCC(usuarioAtual, cc)).map((cc) => (
                                  <option key={cc} value={cc}>{cc}</option>
                                ))}
                              </select>
                            </td>
                            <td style={styles.td}>
                              <div style={styles.actionRow}>
                                <button type="button" style={styles.primaryButtonInline} onClick={salvarEdicaoTecnico}>
                                  Salvar
                                </button>
                                <button
                                  type="button"
                                  style={styles.secondaryButtonInline}
                                  onClick={() => {
                                    setTecnicoEditandoId(null);
                                    setTecnicoEdicaoDraft({ nome: "", cc: "" });
                                  }}
                                >
                                  Cancelar
                                </button>
                              </div>
                            </td>
                          </>
                        ) : (
                          <>
                            <td style={styles.td}>{tec.nome}</td>
                            <td style={styles.td}>{tec.cc}</td>
                            <td style={styles.td}>
                              {roleCanCreateCadastrosTecnicos(usuarioAtual, tec.cc) ? (
                                <div style={styles.actionRow}>
                                  <button
                                    type="button"
                                    style={styles.secondaryButtonInline}
                                    onClick={() => {
                                      setTecnicoEditandoId(tec.id);
                                      setTecnicoEdicaoDraft({ nome: tec.nome || "", cc: tec.cc || "" });
                                    }}
                                  >
                                    Editar
                                  </button>
                                  <button style={styles.deleteButton} onClick={() => excluirTecnico(tec.id)}>Excluir</button>
                                </div>
                              ) : (
                                "-"
                              )}
                            </td>
                          </>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!carregando && pagina === "movimentacoes" && (
          <>
            <div style={styles.section}>
              <div style={styles.movTabsWrap}>
                <button
                  type="button"
                  style={{
                    ...styles.movTabButton,
                    ...(movimentacoesAbaAtiva === "lancar" ? styles.movTabButtonActive : {}),
                  }}
                  onClick={() => setMovimentacoesAbaAtiva("lancar")}
                >
                  [+] Lançar movimentações
                </button>
                <button
                  type="button"
                  style={{
                    ...styles.movTabButton,
                    ...(movimentacoesAbaAtiva === "triangulacao" ? styles.movTabButtonActive : {}),
                  }}
                  onClick={() => setMovimentacoesAbaAtiva("triangulacao")}
                >
                  [TRI] Triangulação entre centros de custo
                </button>
              </div>
            </div>
            {movimentacoesAbaAtiva === "lancar" && (
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>Lançar movimentações</h3>
              <div style={styles.formGrid}>
                <select
                  style={styles.input}
                  value={movForm.tipo}
                  onChange={(e) => {
                    setMovForm({ ...movForm, tipo: e.target.value, tecnico_id: "" });
                    setMovBuscaTecnico("");
                  }}
                >
                  {TIPOS_MOV.map((tipo) => <option key={tipo.value} value={tipo.value}>{tipo.label}</option>)}
                </select>
                <select
                  style={styles.input}
                  value={movForm.cc}
                  onChange={(e) => {
                    setMovForm({ ...movForm, cc: e.target.value, tecnico_id: "" });
                    setMovBuscaTecnico("");
                  }}
                >
                  <option value="">Selecione o CC</option>
                  {CCS.filter((cc) => roleCanManageCC(usuarioAtual, cc)).map((cc) => <option key={cc} value={cc}>{cc}</option>)}
                </select>
                <div>
                  <input
                    style={styles.input}
                    list="movimentacao-itens-list"
                    placeholder="Selecione o item (digite para pesquisar)"
                    value={movBuscaItem}
                    onChange={(e) => {
                      const valor = e.target.value;
                      setMovBuscaItem(valor);
                      const opcao = opcoesItemMovimentacao.find((opt) => opt.label === valor);
                      setMovForm((prev) => ({ ...prev, item_id: opcao ? opcao.id : "" }));
                    }}
                  />
                  <datalist id="movimentacao-itens-list">
                    {opcoesItemMovimentacaoFiltradas.map((opt) => (
                      <option key={opt.id} value={opt.label} />
                    ))}
                  </datalist>
                </div>
                {["saida_tecnico", "devolucao_tecnico", "substituicao_perda", "substituicao_quebra", "substituicao_desgaste"].includes(movForm.tipo) ? (
                  <div>
                    <input
                      style={styles.input}
                      list="movimentacao-tecnicos-list"
                      placeholder="Selecione o técnico (digite para pesquisar)"
                      value={movBuscaTecnico}
                      onChange={(e) => {
                        const valor = e.target.value;
                        setMovBuscaTecnico(valor);
                        const opcao = opcoesTecnicoMovimentacao.find((opt) => opt.label === valor);
                        setMovForm((prev) => ({ ...prev, tecnico_id: opcao ? opcao.id : "" }));
                      }}
                    />
                    <datalist id="movimentacao-tecnicos-list">
                      {opcoesTecnicoMovimentacaoFiltradas.map((opt) => (
                        <option key={opt.id} value={opt.label} />
                      ))}
                    </datalist>
                  </div>
                ) : (
                  <input style={styles.input} disabled placeholder="Técnico não obrigatório para este tipo" />
                )}
                <input style={styles.input} type="number" placeholder="Quantidade" value={movForm.quantidade} onChange={(e) => setMovForm({ ...movForm, quantidade: e.target.value })} />
                <input style={styles.input} placeholder="Observação" value={movForm.observacao} onChange={(e) => setMovForm({ ...movForm, observacao: e.target.value })} />
              </div>
              {["substituicao_perda", "substituicao_quebra"].includes(movForm.tipo) && (
                <div style={styles.warningBox}>Atenção: este tipo de substituição exige gerar desconto/cobrança. O aviso final aparecerá quando o lote for salvo.</div>
              )}
              <div style={styles.actionRow}>
                <button style={styles.primaryButtonInline} onClick={adicionarAoLote}>Adicionar ao lote</button>
                <button style={styles.secondaryButtonInline} onClick={salvarLoteMovimentacoes}>Salvar lote</button>
                <button
                  style={styles.deleteButton}
                  onClick={limparLoteMovimentacoes}
                  disabled={loteMovimentacoes.length === 0}
                >
                  Limpar lote
                </button>
              </div>

              <div style={styles.tableWrap}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Tipo</th>
                      <th style={styles.th}>CC</th>
                      <th style={styles.th}>Item</th>
                      <th style={styles.th}>Técnico</th>
                      <th style={styles.th}>Qtd</th>
                      <th style={styles.th}>Observação</th>
                      <th style={styles.th}>Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loteMovimentacoes.length === 0 ? (
                      <tr><td style={styles.td} colSpan={7}>Nenhuma linha adicionada ao lote.</td></tr>
                    ) : (
                      loteMovimentacoes.map((linha) => {
                        const item = itensById[Number(linha.item_id)];
                        const tecnico = tecnicosById[Number(linha.tecnico_id)];
                        return (
                          <tr key={linha.localId}>
                            <td style={styles.td}>{LABEL_TIPO[linha.tipo] || linha.tipo}</td>
                            <td style={styles.td}>{linha.cc}</td>
                            <td style={styles.td}>{item?.nome || "-"}</td>
                            <td style={styles.td}>{tecnico?.nome || "-"}</td>
                            <td style={styles.td}>{linha.quantidade}</td>
                            <td style={styles.td}>{linha.observacao || "-"}</td>
                            <td style={styles.td}><button style={styles.deleteButton} onClick={() => removerDoLote(linha.localId)}>Remover</button></td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            )}
            {movimentacoesAbaAtiva === "triangulacao" && (
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>Triangulação entre centros de custo</h3>
              {!canUseTriangulacao(usuarioAtual) ? (
                <p style={styles.mutedText}>Seu usuário não possui permissão para usar triangulação.</p>
              ) : (
                <>
                  <div style={styles.formGrid}>
                    <select
                      style={styles.input}
                      aria-label="Centro de custo de origem da triangulação"
                      value={triForm.cc_origem}
                      onChange={(e) => setTriForm({ ...triForm, cc_origem: e.target.value })}
                    >
                      <option value="">CC de origem</option>
                      {CCS.filter((cc) => roleCanManageCC(usuarioAtual, cc)).map((cc) => <option key={cc} value={cc}>{cc}</option>)}
                    </select>
                    <select
                      style={styles.input}
                      aria-label="Centro de custo de destino da triangulação"
                      value={triForm.cc_destino}
                      onChange={(e) => setTriForm({ ...triForm, cc_destino: e.target.value })}
                    >
                      <option value="">CC de destino</option>
                      {CCS.filter((cc) => roleCanViewCC(usuarioAtual, cc)).map((cc) => <option key={cc} value={cc}>{cc}</option>)}
                    </select>
                    <select
                      style={styles.input}
                      aria-label="Item a transferir na triangulação"
                      value={triForm.item_id}
                      onChange={(e) => setTriForm({ ...triForm, item_id: e.target.value })}
                    >
                      <option value="">Selecione o item</option>
                      {itens.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}
                    </select>
                    <input
                      style={styles.input}
                      type="number"
                      aria-label="Quantidade da triangulação"
                      placeholder="Quantidade"
                      value={triForm.quantidade}
                      onChange={(e) => setTriForm({ ...triForm, quantidade: e.target.value })}
                    />
                    <input
                      style={{ ...styles.input, gridColumn: "1 / -1" }}
                      aria-label="Observação da triangulação"
                      placeholder="Observação"
                      value={triForm.observacao}
                      onChange={(e) => setTriForm({ ...triForm, observacao: e.target.value })}
                    />
                  </div>
                  <div style={styles.actionRow}>
                    <button
                      style={{
                        ...styles.primaryButtonInline,
                        ...(!canRequestTriangulacao(usuarioAtual) ? styles.disabledButton : {}),
                      }}
                      onClick={adicionarTriangulacaoAoLote}
                      disabled={!canRequestTriangulacao(usuarioAtual)}
                    >
                      Adicionar ao lote
                    </button>
                    <button
                      style={{
                        ...styles.secondaryButtonInline,
                        ...(!canRequestTriangulacao(usuarioAtual) ? styles.disabledButton : {}),
                      }}
                      onClick={solicitarTriangulacao}
                      disabled={!canRequestTriangulacao(usuarioAtual)}
                    >
                      Solicitar lote
                    </button>
                    <button
                      style={styles.deleteButton}
                      onClick={limparLoteTriangulacoes}
                      disabled={loteTriangulacoes.length === 0}
                    >
                      Limpar lote
                    </button>
                  </div>
                  {!canRequestTriangulacao(usuarioAtual) && (
                    <p style={styles.permissionHint}>Você pode visualizar triangulações, mas não pode solicitar.</p>
                  )}
                  <div style={styles.tableWrap}>
                    <table style={styles.table}>
                      <thead>
                        <tr>
                          <th style={styles.th}>Origem</th>
                          <th style={styles.th}>Destino</th>
                          <th style={styles.th}>Item</th>
                          <th style={styles.th}>Qtd</th>
                          <th style={styles.th}>Observação</th>
                          <th style={styles.th}>Ação</th>
                        </tr>
                      </thead>
                      <tbody>
                        {loteTriangulacoes.length === 0 ? (
                          <tr><td style={styles.td} colSpan={6}>Nenhuma linha adicionada ao lote.</td></tr>
                        ) : (
                          loteTriangulacoes.map((linha) => {
                            const item = itensById[Number(linha.item_id)];
                            return (
                              <tr key={linha.localId}>
                                <td style={styles.td}>{linha.cc_origem}</td>
                                <td style={styles.td}>{linha.cc_destino}</td>
                                <td style={styles.td}>{item?.nome || "-"}</td>
                                <td style={styles.td}>{linha.quantidade}</td>
                                <td style={styles.td}>{linha.observacao || "-"}</td>
                                <td style={styles.td}>
                                  <button style={styles.deleteButton} onClick={() => removerTriangulacaoDoLote(linha.localId)}>
                                    Remover
                                  </button>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div style={styles.tableWrap}>
                    <table style={styles.table}>
                      <thead>
                        <tr>
                          <th style={styles.th}>Data</th>
                          <th style={styles.th}>Origem</th>
                          <th style={styles.th}>Destino</th>
                          <th style={styles.th}>Item</th>
                          <th style={styles.th}>Qtd</th>
                          <th style={styles.th}>Observação</th>
                          <th style={styles.th}>Solicitado por</th>
                          <th style={styles.th}>Status</th>
                          <th style={styles.th}>Aprovado/Reprovado por</th>
                          <th style={styles.th}>Ação</th>
                        </tr>
                      </thead>
                      <tbody>
                        {triangulacoes.length === 0 ? (
                          <tr><td style={styles.td} colSpan={10}>Nenhuma triangulação solicitada.</td></tr>
                        ) : (
                          triangulacoes.map((tri) => {
                            const item = itensById[Number(tri.item_id)];
                            const podeAprovar = tri.status === "Pendente" && roleCanApproveTriangulacao(usuarioAtual, tri.cc_origem, tri.cc_destino);
                            return (
                              <tr key={tri.id}>
                                <td style={styles.td}>{new Date(tri.created_at).toLocaleString("pt-BR")}</td>
                                <td style={styles.td}>{tri.cc_origem}</td>
                                <td style={styles.td}>{tri.cc_destino}</td>
                                <td style={styles.td}>{item?.nome || `Item #${tri.item_id}`}</td>
                                <td style={styles.td}>{tri.quantidade}</td>
                                <td style={styles.td}>{tri.observacao || "-"}</td>
                                <td style={styles.td}>{tri.solicitado_nome}</td>
                                <td style={styles.td}>{tri.status}</td>
                                <td style={styles.td}>{tri.aprovado_nome || "-"}</td>
                                <td style={styles.td}>
                                  {podeAprovar ? (
                                    <div style={styles.actionRow}>
                                      <button style={styles.approveButton} onClick={() => aprovarTriangulacao(tri)}>Aprovar</button>
                                      <button style={styles.deleteButton} onClick={() => reprovarTriangulacao(tri)}>Reprovar</button>
                                    </div>
                                  ) : (
                                    "-"
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
            )}

            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>Histórico de movimentações</h3>
              <div style={styles.tableWrap}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Data</th>
                      <th style={styles.th}>Tipo</th>
                      <th style={styles.th}>CC</th>
                      <th style={styles.th}>Item</th>
                      <th style={styles.th}>Técnico</th>
                      <th style={styles.th}>Movimentado por</th>
                      <th style={styles.th}>Qtd</th>
                      <th style={styles.th}>Observação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movimentacoes.filter((mov) => roleCanViewCC(usuarioAtual, mov.cc)).length === 0 ? (
                      <tr><td style={styles.td} colSpan={8}>Nenhuma movimentação cadastrada.</td></tr>
                    ) : (
                      movimentacoes
                        .filter((mov) => roleCanViewCC(usuarioAtual, mov.cc))
                        .map((mov) => {
                          const item = itensById[Number(mov.item_id)];
                          const tecnico = tecnicosById[Number(mov.tecnico_id)];
                          return (
                            <tr key={mov.id}>
                              <td style={styles.td}>{mov.created_at ? new Date(mov.created_at).toLocaleString("pt-BR") : "-"}</td>
                              <td style={styles.td}>{LABEL_TIPO[mov.tipo] || mov.tipo}</td>
                              <td style={styles.td}>{mov.cc}</td>
                              <td style={styles.td}>{item?.nome || `Item #${mov.item_id}`}</td>
                              <td style={styles.td}>{tecnico?.nome || "-"}</td>
                              <td style={styles.td}>{mov.movimentado_nome || mov.movimentado_por || "-"}</td>
                              <td style={styles.td}>{mov.quantidade}</td>
                              <td style={styles.td}>{mov.observacao || "-"}</td>
                            </tr>
                          );
                        })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {!carregando && pagina === "estoque" && (
          <div style={styles.section}>
            <div style={styles.sectionHeaderLine}>
              <h3 style={styles.sectionTitle}>Visão consolidada de estoque</h3>
              <div style={styles.actionRow}>
                <button
                  style={styles.secondaryButtonInline}
                  onClick={() => setMostrarItensZerados((prev) => !prev)}
                >
                  {mostrarItensZerados ? "Ocultar itens zerados" : "Mostrar itens zerados"}
                </button>
                <button style={styles.secondaryButtonInline} onClick={exportarRelatorioEstoqueExcel}>
                  Exportar relatório completo
                </button>
              </div>
            </div>
            <p style={styles.mutedText}>
              Visualize em uma única tabela os totais por item e CC. Use os filtros para refinar por centro de custo, técnico, item e nome.
            </p>
            <div style={styles.formGrid}>
              <select style={styles.input} value={estoqueFiltro.cc} onChange={(e) => setEstoqueFiltro({ ...estoqueFiltro, cc: e.target.value, tecnico_id: "" })}>
                <option value="">Filtrar por CC</option>
                {CCS.filter((cc) => roleCanViewCC(usuarioAtual, cc)).map((cc) => <option key={cc} value={cc}>{cc}</option>)}
              </select>
              <select style={styles.input} value={estoqueFiltro.tecnico_id} onChange={(e) => setEstoqueFiltro({ ...estoqueFiltro, tecnico_id: e.target.value })}>
                <option value="">Filtrar por técnico</option>
                {tecnicosVisiveis.filter((tec) => !estoqueFiltro.cc || tec.cc === estoqueFiltro.cc).map((tec) => <option key={tec.id} value={tec.id}>{tec.nome}</option>)}
              </select>
              <select style={styles.input} value={estoqueFiltro.item_id} onChange={(e) => setEstoqueFiltro({ ...estoqueFiltro, item_id: e.target.value })}>
                <option value="">Filtrar por item</option>
                {itens.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}
              </select>
              <input
                style={styles.input}
                placeholder="Pesquisar item por nome"
                value={estoqueFiltro.busca_nome}
                onChange={(e) => setEstoqueFiltro({ ...estoqueFiltro, busca_nome: e.target.value })}
              />
            </div>
            <div style={styles.tableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Item</th>
                    <th style={styles.th}>No estoque</th>
                    <th style={styles.th}>Com técnicos</th>
                    <th style={styles.th}>Total</th>
                    <th style={styles.th}>Mínimo</th>
                  </tr>
                </thead>
                <tbody>
                  {estoqueConsolidadoFiltrado.length === 0 ? (
                    <tr><td style={styles.td} colSpan={5}>Nenhum registro encontrado para os filtros selecionados.</td></tr>
                  ) : (
                    estoqueConsolidadoFiltrado.map((registro, index) => (
                      <tr key={`${registro.itemId}-${index}`}>
                        <td style={styles.td}>{registro.itemNome}</td>
                        <td style={styles.td}>{registro.estoque}</td>
                        <td style={styles.td}>{registro.comTecnico}</td>
                        <td style={styles.td}>{registro.total}</td>
                        <td style={styles.td}>{registro.minimo}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!carregando && pagina === "usuarios" && roleCanManageUsers(usuarioAtual) && (
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Usuários e cargos</h3>
                <div style={styles.formGrid}>
                  <input style={styles.input} placeholder="Nome" value={usuarioForm.nome} onChange={(e) => setUsuarioForm({ ...usuarioForm, nome: e.target.value })} />
                  <input style={styles.input} placeholder="Usuário" value={usuarioForm.usuario} onChange={(e) => setUsuarioForm({ ...usuarioForm, usuario: e.target.value })} />
                  <input style={styles.input} placeholder={`Senha (opcional, padrão: ${DEFAULT_USER_PASSWORD})`} value={usuarioForm.senha} onChange={(e) => setUsuarioForm({ ...usuarioForm, senha: e.target.value })} />
                  <select
                    style={styles.input}
                    value={usuarioForm.cargo}
                    onChange={(e) =>
                      setUsuarioForm((prev) => ({
                        ...prev,
                        cargo: e.target.value,
                        ccs: ["Admin", "Gerente", "SUP. Almoxarifado"].includes(e.target.value) ? [...CCS] : [],
                        permissions: getDefaultPermissions(e.target.value),
                      }))
                    }
                  >
                    {CARGOS.map((cargo) => <option key={cargo} value={cargo}>{cargo}</option>)}
                  </select>
                </div>

                <div style={styles.sectionMini}>
                  <h4 style={styles.sectionMiniTitle}>Permissões do usuário</h4>
                  <div style={styles.permissionGrid}>
                    <label style={styles.permissionCard}>
                      <input type="checkbox" checked={usuarioForm.permissions?.triangulacaoAcesso === true} onChange={(e) => setUsuarioForm((prev) => ({ ...prev, permissions: { ...prev.permissions, triangulacaoAcesso: e.target.checked } }))} />
                      <div>
                        <strong>Acessar triangulação</strong>
                        <div style={styles.permissionHint}>Mostra a área de triangulação.</div>
                      </div>
                    </label>
                    <label style={styles.permissionCard}>
                      <input type="checkbox" checked={usuarioForm.permissions?.triangulacaoSolicitar === true} onChange={(e) => setUsuarioForm((prev) => ({ ...prev, permissions: { ...prev.permissions, triangulacaoSolicitar: e.target.checked } }))} />
                      <div>
                        <strong>Solicitar triangulação</strong>
                        <div style={styles.permissionHint}>Permite abrir solicitações.</div>
                      </div>
                    </label>
                    <label style={styles.permissionCard}>
                      <input type="checkbox" checked={usuarioForm.permissions?.triangulacaoAprovar === true} onChange={(e) => setUsuarioForm((prev) => ({ ...prev, permissions: { ...prev.permissions, triangulacaoAprovar: e.target.checked } }))} />
                      <div>
                        <strong>Aprovar triangulação</strong>
                        <div style={styles.permissionHint}>Permite aprovar/reprovar dentro dos CCs autorizados.</div>
                      </div>
                    </label>
                    <label style={styles.permissionCard}>
                      <input type="checkbox" checked={usuarioForm.permissions?.visualizarValores === true} onChange={(e) => setUsuarioForm((prev) => ({ ...prev, permissions: { ...prev.permissions, visualizarValores: e.target.checked } }))} />
                      <div>
                        <strong>Visualizar valores</strong>
                        <div style={styles.permissionHint}>Permite ver os valores totais no dashboard.</div>
                      </div>
                    </label>
                    <label style={styles.permissionCard}>
                      <input type="checkbox" checked={usuarioForm.permissions?.cadastroItens === true} onChange={(e) => setUsuarioForm((prev) => ({ ...prev, permissions: { ...prev.permissions, cadastroItens: e.target.checked } }))} />
                      <div>
                        <strong>Cadastro de itens</strong>
                        <div style={styles.permissionHint}>Cadastrar, importar e excluir itens.</div>
                      </div>
                    </label>
                    <label style={styles.permissionCard}>
                      <input type="checkbox" checked={usuarioForm.permissions?.cadastroTecnicos === true} onChange={(e) => setUsuarioForm((prev) => ({ ...prev, permissions: { ...prev.permissions, cadastroTecnicos: e.target.checked } }))} />
                      <div>
                        <strong>Cadastro de técnicos</strong>
                        <div style={styles.permissionHint}>Cadastrar, importar e excluir técnicos.</div>
                      </div>
                    </label>
                  </div>
                </div>

                {!["Admin", "Gerente", "SUP. Almoxarifado"].includes(usuarioForm.cargo) && (
                  <div style={styles.sectionMini}>
                    <h4 style={styles.sectionMiniTitle}>Escolher manualmente os CCs</h4>
                    <div style={styles.ccSelectorGrid}>
                      {CCS.map((cc) => (
                        <label key={cc} style={styles.ccChip}>
                          <input
                            type="checkbox"
                            checked={usuarioForm.ccs.includes(cc)}
                            onChange={(e) =>
                              setUsuarioForm((prev) => ({
                                ...prev,
                                ccs: e.target.checked
                                  ? [...prev.ccs, cc]
                                  : prev.ccs.filter((item) => item !== cc),
                              }))
                            }
                          />
                          <span>{cc}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                <button style={styles.primaryButtonInline} onClick={cadastrarUsuario}>Cadastrar usuário</button>
                <p style={styles.permissionHint}>
                  Se a senha ficar em branco, o usuário será criado com senha padrão e será obrigado a trocar no primeiro acesso.
                </p>

            <div style={styles.sectionMini}>
              <input
                style={styles.input}
                placeholder="Buscar usuário por nome ou login"
                value={buscaUsuario}
                onChange={(e) => setBuscaUsuario(e.target.value)}
              />
            </div>

            <div style={styles.userCardsGrid}>
              {usuariosFiltrados.length === 0 ? (
                <div style={styles.sectionMini}>
                  Nenhum usuário encontrado para o filtro informado.
                </div>
              ) : (
                usuariosFiltrados.map((user) => {
                const expandido = usuarioExpandidoId === user.id;
                return (
                  <div key={user.id} style={styles.userCard}>
                    <div style={styles.userCardHeader}>
                      <div>
                        <div style={styles.userCardName}>{user.nome}</div>
                        <div style={styles.userCardMeta}>
                          {user.usuario} • {user.cargo} • {user.ativo === false ? "Inativo" : "Ativo"}
                        </div>
                      </div>
                      <div style={styles.actionRow}>
                        {roleCanManageUsers(usuarioAtual) && (
                          <button style={styles.secondaryButtonInline} onClick={() => setUsuarioExpandidoId((prev) => (prev === user.id ? null : user.id))}>
                            {expandido ? "Recolher" : "Configurar"}
                          </button>
                        )}
                        {roleCanManageUsers(usuarioAtual) && (
                          <button style={styles.secondaryButtonInline} onClick={() => alternarUsuarioAtivo(user.id)}>
                            {user.ativo === false ? "Ativar" : "Desativar"}
                          </button>
                        )}
                        {roleCanManageUsers(usuarioAtual) && (
                          <button style={styles.deleteButton} onClick={() => excluirUsuario(user.id)}>
                            Excluir
                          </button>
                        )}
                        {roleCanManageUsers(usuarioAtual) && (
                          <button style={styles.secondaryButtonInline} onClick={() => resetarSenhaUsuario(user.id)}>
                            Resetar senha
                          </button>
                        )}
                      </div>
                    </div>

                    <div style={styles.userChipsRow}>
                      {(user.ccs || []).length === 0 ? (
                        <span style={styles.userChipMuted}>Sem CC liberado</span>
                      ) : (
                        (user.ccs || []).map((cc) => <span key={cc} style={styles.userChip}>{cc}</span>)
                      )}
                    </div>

                    <div style={styles.userPermissionRow}>
                      <PermissionBadge ativo={user.permissions?.triangulacaoAcesso} label="Acesso triangulação" />
                      <PermissionBadge ativo={user.permissions?.triangulacaoSolicitar} label="Solicitar triangulação" />
                      <PermissionBadge ativo={user.permissions?.triangulacaoAprovar} label="Aprovar triangulação" />
                      <PermissionBadge ativo={user.permissions?.visualizarValores} label="Visualizar valores" />
                      <PermissionBadge ativo={user.permissions?.cadastroItens} label="Cadastro de itens" />
                      <PermissionBadge ativo={user.permissions?.cadastroTecnicos} label="Cadastro de técnicos" />
                    </div>

                    {expandido && roleCanManageUsers(usuarioAtual) && (
                      <div style={styles.userCardBody}>
                        {!["Admin", "Gerente", "SUP. Almoxarifado"].includes(user.cargo) ? (
                          <>
                            <h4 style={styles.sectionMiniTitle}>Escolher manualmente os CCs</h4>
                            <div style={styles.ccSelectorGrid}>
                              {CCS.map((cc) => (
                                <label key={cc} style={styles.ccChip}>
                                  <input type="checkbox" checked={(user.ccs || []).includes(cc)} onChange={(e) => atualizarUsuarioCC(user.id, cc, e.target.checked)} />
                                  <span>{cc}</span>
                                </label>
                              ))}
                            </div>
                          </>
                        ) : (
                          <div style={styles.permissionHint}>Esse cargo tem acesso automático a todos os CCs.</div>
                        )}

                        <h4 style={{ ...styles.sectionMiniTitle, marginTop: 18 }}>O que esse usuário pode fazer</h4>
                        <div style={styles.permissionGrid}>
                          <label style={styles.permissionCard}>
                            <input type="checkbox" checked={user.permissions?.triangulacaoAcesso === true} onChange={(e) => atualizarUsuarioPermissao(user.id, "triangulacaoAcesso", e.target.checked)} />
                            <div>
                              <strong>Acessar triangulação</strong>
                              <div style={styles.permissionHint}>Mostrar área de triangulação.</div>
                            </div>
                          </label>
                          <label style={styles.permissionCard}>
                            <input type="checkbox" checked={user.permissions?.triangulacaoSolicitar === true} onChange={(e) => atualizarUsuarioPermissao(user.id, "triangulacaoSolicitar", e.target.checked)} />
                            <div>
                              <strong>Solicitar triangulação</strong>
                              <div style={styles.permissionHint}>Criar solicitações.</div>
                            </div>
                          </label>
                          <label style={styles.permissionCard}>
                            <input type="checkbox" checked={user.permissions?.triangulacaoAprovar === true} onChange={(e) => atualizarUsuarioPermissao(user.id, "triangulacaoAprovar", e.target.checked)} />
                            <div>
                              <strong>Aprovar triangulação</strong>
                              <div style={styles.permissionHint}>Aprovar/reprovar solicitações.</div>
                            </div>
                          </label>
                          <label style={styles.permissionCard}>
                            <input type="checkbox" checked={user.permissions?.visualizarValores === true} onChange={(e) => atualizarUsuarioPermissao(user.id, "visualizarValores", e.target.checked)} />
                            <div>
                              <strong>Visualizar valores</strong>
                              <div style={styles.permissionHint}>Exibir valores totais financeiros no dashboard.</div>
                            </div>
                          </label>
                          <label style={styles.permissionCard}>
                            <input type="checkbox" checked={user.permissions?.cadastroItens === true} onChange={(e) => atualizarUsuarioPermissao(user.id, "cadastroItens", e.target.checked)} />
                            <div>
                              <strong>Cadastro de itens</strong>
                              <div style={styles.permissionHint}>Cadastro, importação e exclusão.</div>
                            </div>
                          </label>
                          <label style={styles.permissionCard}>
                            <input type="checkbox" checked={user.permissions?.cadastroTecnicos === true} onChange={(e) => atualizarUsuarioPermissao(user.id, "cadastroTecnicos", e.target.checked)} />
                            <div>
                              <strong>Cadastro de técnicos</strong>
                              <div style={styles.permissionHint}>Cadastro, importação e exclusão.</div>
                            </div>
                          </label>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
              )}
            </div>

            <div style={styles.sectionMini}>
              <h4 style={styles.sectionMiniTitle}>Regras de acesso implantadas</h4>
              <div style={styles.minimosLista}>
                <div style={styles.minimoLinha}><strong>Admin:</strong> acesso total.</div>
                <div style={styles.minimoLinha}><strong>Gerente:</strong> acesso total.</div>
                <div style={styles.minimoLinha}><strong>Coordenador:</strong> vê tudo, movimenta apenas os próprios CCs e aprova triangulação somente quando origem e destino são dos CCs sob sua responsabilidade.</div>
                <div style={styles.minimoLinha}><strong>SUP. Almoxarifado:</strong> vê e movimenta todos os CCs, mas não aprova triangulação automaticamente sem a permissão ligada.</div>
                <div style={styles.minimoLinha}><strong>Sup. Técnico:</strong> apenas consulta o próprio CC, salvo permissões adicionais liberadas manualmente.</div>
                <div style={styles.minimoLinha}><strong>Ass.Logistica:</strong> vê e movimenta apenas os próprios CCs, de acordo com as permissões ligadas.</div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
    </>
  );
}

function ToastStack({ toasts }) {
  if (!toasts?.length) return null;
  return (
    <div
      style={{
        position: "fixed",
        top: 16,
        right: 16,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        maxWidth: 420,
        pointerEvents: "none",
      }}
      role="region"
      aria-label="Notificações do sistema"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          aria-live="polite"
          style={{
            pointerEvents: "auto",
            padding: "12px 16px",
            borderRadius: theme.radius.md,
            background:
              t.variant === "error"
                ? "#fef2f2"
                : t.variant === "success"
                  ? "#f0fdf4"
                  : "#eff6ff",
            border: `1px solid ${
              t.variant === "error" ? "#fecaca" : t.variant === "success" ? "#bbf7d0" : "#bfdbfe"
            }`,
            color: theme.colors.slate900,
            fontSize: 14,
            fontFamily: theme.fontStack,
            boxShadow: theme.shadow.soft,
          }}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}

function DashboardIcon({ iconKey }) {
  const common = { ...styles.cardIconSvg, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };
  if (iconKey === "kits") {
    return (
      <svg {...common}>
        <path d="M3 8.5 12 4l9 4.5-9 4.5L3 8.5Z" />
        <path d="M3 8.5V16l9 4 9-4V8.5" />
        <path d="M12 13v7" />
      </svg>
    );
  }
  if (iconKey === "tecnicos") {
    return (
      <svg {...common}>
        <circle cx="9" cy="8" r="2.5" />
        <circle cx="16.5" cy="9" r="2" />
        <path d="M4.5 18c.7-2.3 2.4-3.5 4.5-3.5S12.8 15.7 13.5 18" />
        <path d="M14 17.5c.5-1.6 1.7-2.5 3.3-2.5 1.4 0 2.6.8 3.2 2.3" />
      </svg>
    );
  }
  if (iconKey === "estoque") {
    return (
      <svg {...common}>
        <path d="M3 21h18" />
        <rect x="5" y="10" width="14" height="11" rx="1.5" />
        <path d="M8 10V6.5a1.5 1.5 0 0 1 1.5-1.5h5A1.5 1.5 0 0 1 16 6.5V10" />
      </svg>
    );
  }
  if (iconKey === "campo") {
    return (
      <svg {...common}>
        <path d="M4 19h16" />
        <path d="M8 19v-8l4-2 4 2v8" />
        <circle cx="12" cy="6.5" r="2" />
      </svg>
    );
  }
  if (iconKey === "critico") {
    return (
      <svg {...common}>
        <path d="m6 8 10 10" />
        <path d="M8.8 5.2a2.2 2.2 0 0 1 3.1 0l1.9 1.9a2.2 2.2 0 0 1 0 3.1L9.7 14.3a2.2 2.2 0 0 1-3.1 0l-1.9-1.9a2.2 2.2 0 0 1 0-3.1Z" />
        <path d="m16.5 5.5 4 4" />
        <path d="m20.5 5.5-4 4" />
      </svg>
    );
  }
  if (iconKey === "money") {
    return (
      <svg {...common}>
        <path d="M12 4v16" />
        <path d="M16.3 7.3c-.8-.9-2.4-1.5-4.3-1.5-2.6 0-4.5 1.3-4.5 3.2 0 5 9.1 2.1 9.1 6.4 0 1.8-1.8 3.1-4.6 3.1-1.8 0-3.6-.7-4.5-1.8" />
      </svg>
    );
  }
  return null;
}

function MetricCard({ titulo, valor, destaque = false, iconKey = null, onClick = null }) {
  const cardStyle = {
    ...styles.card,
    ...(destaque ? styles.cardHighlight : {}),
    ...(onClick ? styles.cardClickable : {}),
  };
  const inner = (
    <>
      <div style={styles.cardTitleRow}>
        <div style={styles.cardTitle}>{titulo}</div>
        {iconKey ? <span style={styles.cardIcon}><DashboardIcon iconKey={iconKey} /></span> : null}
      </div>
      <div style={styles.cardValueSmall}>{valor}</div>
    </>
  );
  if (onClick) {
    return (
      <div
        role="button"
        tabIndex={0}
        style={cardStyle}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        }}
      >
        {inner}
      </div>
    );
  }
  return <div style={cardStyle}>{inner}</div>;
}

function SummaryBox({ titulo, valor }) {
  return (
    <div style={styles.summaryBox}>
      <div style={styles.cardTitle}>{titulo}</div>
      <div style={styles.summaryValue}>{valor}</div>
    </div>
  );
}

function PermissionBadge({ ativo, label }) {
  return (
    <span
      style={{
        ...styles.permissionBadge,
        ...(ativo ? styles.permissionBadgeOn : styles.permissionBadgeOff),
      }}
    >
      {label}
    </span>
  );
}

function MenuIcon({ iconKey }) {
  const common = {
    ...styles.menuIconSvg,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };

  if (iconKey === "dashboard") {
    return (
      <svg {...common}>
        <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.5" />
        <rect x="13" y="3.5" width="7.5" height="4.5" rx="1.5" />
        <rect x="13" y="10" width="7.5" height="10.5" rx="1.5" />
        <rect x="3.5" y="13" width="7.5" height="7.5" rx="1.5" />
      </svg>
    );
  }
  if (iconKey === "itens") {
    return (
      <svg {...common}>
        <rect x="4" y="5" width="16" height="14" rx="2" />
        <path d="M9 5v14" />
      </svg>
    );
  }
  if (iconKey === "tecnicos") {
    return (
      <svg {...common}>
        <circle cx="9" cy="8.5" r="2.3" />
        <circle cx="16" cy="9.5" r="1.9" />
        <path d="M5.3 18c.8-2.1 2.2-3.2 3.7-3.2 1.6 0 3 .9 3.8 3" />
        <path d="M14 17.8c.5-1.4 1.5-2.2 2.8-2.2s2.3.7 2.9 2" />
      </svg>
    );
  }
  if (iconKey === "movimentacoes") {
    return (
      <svg {...common}>
        <path d="M4 8h12" />
        <path d="m12 4 4 4-4 4" />
        <path d="M20 16H8" />
        <path d="m12 12-4 4 4 4" />
      </svg>
    );
  }
  if (iconKey === "estoque") {
    return (
      <svg {...common}>
        <path d="M3 21h18" />
        <rect x="5" y="10" width="14" height="11" rx="1.5" />
        <path d="M8 10V6.5a1.5 1.5 0 0 1 1.5-1.5h5A1.5 1.5 0 0 1 16 6.5V10" />
      </svg>
    );
  }
  if (iconKey === "usuarios") {
    return (
      <svg {...common}>
        <circle cx="12" cy="8" r="2.5" />
        <path d="M6 19c.9-2.5 2.8-3.8 6-3.8s5.1 1.3 6 3.8" />
      </svg>
    );
  }
  return null;
}

const styles = {
  loginBg: {
    minHeight: "100vh",
    background: "linear-gradient(135deg, #e2e8f0 0%, #f8fafc 55%, #dbeafe 100%)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    fontFamily: theme.fontStack,
  },
  loginCard: {
    width: "100%",
    maxWidth: 460,
    background: "#ffffff",
    borderRadius: 24,
    padding: 32,
    boxShadow: "0 24px 60px rgba(15,23,42,0.16)", border: "1px solid rgba(148,163,184,0.22)",
    boxSizing: "border-box",
  },
  brandRow: { display: "flex", alignItems: "center", gap: 14, marginBottom: 8 },
  brandLogo: { width: 70, height: 36, objectFit: "contain", borderRadius: 6 },
  loginBadge: { display: "inline-flex", background: "#e0e7ff", color: "#3730a3", padding: "6px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700, marginBottom: 14 },
  loginTitle: { marginTop: 0, marginBottom: 10, color: "#0f172a", fontSize: 32, lineHeight: 1.1, letterSpacing: "-0.02em" },
  loginText: { marginTop: 0, marginBottom: 20, color: "#475569", fontSize: 14 },
  label: { display: "block", marginBottom: 8, color: "#0f172a", fontWeight: 600 },
  input: {
    width: "100%",
    padding: 12,
    marginBottom: 16,
    borderRadius: 10,
    border: "1px solid #cbd5e1", boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
    boxSizing: "border-box",
    fontSize: 14,
    background: "#fff",
  },
  primaryButton: {
    width: "100%",
    padding: 14,
    borderRadius: 10,
    border: 0,
    background: "linear-gradient(135deg, #0f172a 0%, #1d4ed8 100%)",
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
    border: "1px solid #cbd5e1", boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
    background: "#ffffff",
    color: "#0f172a",
    cursor: "pointer",
    fontSize: 14,
  },
  disabledButton: {
    opacity: 0.6,
    cursor: "not-allowed",
  },
  approveButton: {
    padding: "8px 12px",
    borderRadius: 8,
    border: 0,
    background: "#16a34a",
    color: "#ffffff",
    cursor: "pointer",
  },
  deleteButton: {
    padding: "8px 12px",
    borderRadius: 8,
    border: 0,
    background: "#dc2626",
    color: "#ffffff",
    cursor: "pointer",
  },
  fileButton: {
    padding: "12px 18px",
    borderRadius: 10,
    border: "1px solid #cbd5e1", boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
    background: "#ffffff",
    color: "#0f172a",
    cursor: "pointer",
    fontSize: 14,
    display: "inline-flex",
    alignItems: "center",
  },
  actionRow: { display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" },
  loginHint: { marginTop: 16, fontSize: 12, color: "#64748b" },
  appShell: { minHeight: "100vh", display: "flex", background: theme.colors.surface, fontFamily: theme.fontStack },
  sidebar: { width: 280, background: "linear-gradient(180deg, #0b1220 0%, #111827 100%)", color: "#ffffff", padding: 24, boxSizing: "border-box", boxShadow: "8px 0 30px rgba(15,23,42,0.18)", position: "sticky", top: 0, height: "100vh", overflowY: "auto" },
  sidebarHeader: { marginBottom: 18, lineHeight: 1.15, display: "flex", flexDirection: "column", gap: 8 },
  sidebarBrandRow: { display: "flex", alignItems: "center", gap: 10 },
  sidebarLogo: { width: 100, height: 44, objectFit: "contain", borderRadius: 6, background: "#ffffff", padding: "4px 6px" },
  sidebarNetPr: { fontSize: 28, fontWeight: 800, letterSpacing: 0.5, color: "#ffffff" },
  sidebarTitle: { fontSize: 28, fontWeight: 800, letterSpacing: 0.5, color: "#ffffff" },
  userBox: { background: "rgba(30,41,59,0.9)", borderRadius: 14, padding: 12, marginBottom: 22, border: "1px solid rgba(148,163,184,0.2)" },
  userBoxName: { fontWeight: 700 },
  userBoxRole: { color: "#cbd5e1", marginTop: 6, fontSize: 13 },
  menu: { display: "flex", flexDirection: "column", gap: 10 },
  menuButtonContent: { display: "inline-flex", alignItems: "center", gap: 10 },
  menuIconSvg: { width: 18, height: 18, display: "block" },
  menuButton: {
    background: "transparent",
    color: "#cbd5e1",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 12,
    padding: 12,
    textAlign: "left",
    cursor: "pointer",
    fontSize: 14,
  },
  menuButtonActive: {
    background: "linear-gradient(135deg, rgba(30,41,59,1) 0%, rgba(37,99,235,0.32) 100%)",
    color: "#bfdbfe",
    border: "1px solid rgba(96,165,250,0.5)",
    boxShadow: "inset 0 0 0 1px rgba(30,64,175,0.25)",
  },
  main: { flex: 1, padding: 32, boxSizing: "border-box", maxWidth: "calc(100vw - 280px)" },
  topbar: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, gap: 16, background: "#ffffff", border: "1px solid #dbeafe", borderRadius: 16, padding: "14px 18px", boxShadow: "0 8px 18px rgba(15,23,42,0.06)", backdropFilter: "blur(4px)" },
  pageTitle: { margin: 0, color: "#0f172a" },
  topbarSub: { color: "#64748b", fontSize: 14, marginTop: 6 },
  logoutButton: { padding: "10px 16px", borderRadius: 10, border: 0, background: "#0f172a", color: "#ffffff", cursor: "pointer" },
  cardsGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 },
  card: { background: "#ffffff", borderRadius: 18, padding: 20, boxShadow: "0 16px 36px rgba(15,23,42,0.08)", minHeight: 120, border: "1px solid #e2e8f0", transition: "transform 0.2s ease" },
  cardClickable: { cursor: "pointer", outline: "none" },
  cardHighlight: { border: "2px solid #fecaca" },
  cardTitleRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 },
  cardTitle: { color: "#334155", fontSize: 15 },
  cardIcon: { color: "#1d4ed8", lineHeight: 1, display: "inline-flex", alignItems: "center" },
  cardIconSvg: { width: 22, height: 22, display: "block" },
  cardValueSmall: { marginTop: 12, fontSize: 22, fontWeight: 700, color: "#0f172a", lineHeight: 1.25 },
  section: { background: "#ffffff", borderRadius: 18, padding: 20, boxShadow: "0 16px 36px rgba(15,23,42,0.08)", marginTop: 24, border: "1px solid #e2e8f0" },
  sectionMini: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 14, padding: 16, marginTop: 16, marginBottom: 16 },
  sectionMiniTitle: { marginTop: 0, marginBottom: 16, color: "#0f172a" },
  sectionTitle: { marginTop: 0, color: "#0f172a" },
  sectionHeaderLine: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" },
  dashboardTabsRow: { display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 },
  dashboardTabButton: {
    border: "1px solid #cbd5e1",
    borderRadius: 10,
    background: "#f8fafc",
    color: "#0f172a",
    fontWeight: 600,
    padding: "8px 12px",
    cursor: "pointer",
  },
  dashboardTabButtonActive: {
    border: "1px solid #2563eb",
    background: "#dbeafe",
    color: "#1d4ed8",
  },
  movTabsWrap: {
    display: "inline-flex",
    gap: 10,
    flexWrap: "wrap",
    padding: 8,
    borderRadius: 14,
    border: "1px solid #dbeafe",
    background: "linear-gradient(180deg, #f8fbff 0%, #eef4ff 100%)",
  },
  movTabButton: {
    border: "1px solid #bfdbfe",
    borderRadius: 12,
    background: "#ffffff",
    color: "#1e293b",
    fontWeight: 700,
    padding: "10px 16px",
    cursor: "pointer",
    boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
    transition: "all 0.2s ease",
  },
  movTabButtonActive: {
    border: "1px solid #2563eb",
    background: "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)",
    color: "#ffffff",
    boxShadow: "0 6px 14px rgba(37,99,235,0.25)",
  },
  mutedText: { color: "#64748b", marginBottom: 0 },
  warningText: { color: "#9a3412", background: "#fff7ed", border: "1px solid #fdba74", borderRadius: 10, padding: "8px 10px", marginBottom: 12, fontSize: 13 },
  formGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 12 },
  tableWrap: { marginTop: 24, overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { textAlign: "left", padding: 12, borderBottom: "1px solid #e2e8f0", color: "#334155", fontSize: 14, verticalAlign: "top" },
  td: { padding: 12, borderBottom: "1px solid #e2e8f0", fontSize: 14, color: "#0f172a", verticalAlign: "top" },
  minimosLista: { display: "flex", flexDirection: "column", gap: 4, minWidth: 240 },
  minimoLinha: { fontSize: 12, color: "#334155" },
  warningBox: { background: "#fff7ed", border: "1px solid #fdba74", color: "#9a3412", borderRadius: 12, padding: 12, marginBottom: 16 },
  summaryGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 },
  summaryBox: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 14, padding: 16 },
  summaryValue: { fontSize: 20, fontWeight: 700, marginTop: 8, color: "#0f172a" },
  checkboxGrid: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 },
  checkboxLabel: { display: "flex", gap: 8, alignItems: "center", fontSize: 14 },
  permissionGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 },
  permissionCard: { display: "flex", gap: 12, alignItems: "flex-start", padding: 14, borderRadius: 14, border: "1px solid #dbeafe", background: "#f8fbff" },
  permissionHint: { marginTop: 4, color: "#64748b", fontSize: 12, lineHeight: 1.4 },
  ccSelectorGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10 },
  ccChip: { display: "flex", gap: 10, alignItems: "center", padding: 12, borderRadius: 14, border: "1px solid #cbd5e1", background: "#fff" },
  userCardsGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 16, marginTop: 24 },
  userCard: { border: "1px solid #e2e8f0", borderRadius: 18, padding: 18, background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)" },
  userCardHeader: { display: "flex", justifyContent: "space-between", gap: 14, flexWrap: "wrap", alignItems: "center" },
  userCardName: { fontSize: 18, fontWeight: 700, color: "#0f172a" },
  userCardMeta: { fontSize: 13, color: "#64748b", marginTop: 6 },
  userCardBody: { marginTop: 18, paddingTop: 18, borderTop: "1px solid #e2e8f0" },
  userChipsRow: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 },
  userChip: { padding: "6px 10px", borderRadius: 999, background: "#dbeafe", color: "#1d4ed8", fontSize: 12, fontWeight: 700 },
  userChipMuted: { padding: "6px 10px", borderRadius: 999, background: "#e2e8f0", color: "#475569", fontSize: 12, fontWeight: 700 },
  userPermissionRow: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 },
  permissionBadge: { padding: "6px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700, border: "1px solid transparent" },
  permissionBadgeOn: { background: "#dcfce7", color: "#166534", borderColor: "#bbf7d0" },
  permissionBadgeOff: { background: "#fee2e2", color: "#991b1b", borderColor: "#fecaca" },
};
