import { useState } from "react";

export default function App() {
const [logado, setLogado] = useState(false);
const [usuario, setUsuario] = useState("");
const [senha, setSenha] = useState("");

const login = () => {
if (usuario === "admin" && senha === "admin123") {
setLogado(true);
} else {
alert("Login inválido");
}
};

if (!logado) {
return (
<div style={{ padding: 40 }}> <h2>Login Sistema</h2>
<input placeholder="Usuário" onChange={(e) => setUsuario(e.target.value)} /> <br /><br />
<input type="password" placeholder="Senha" onChange={(e) => setSenha(e.target.value)} /> <br /><br /> <button onClick={login}>Entrar</button> </div>
);
}

return (
<div style={{ padding: 40 }}> <h1>Ferramentaria NET PR</h1> <p>Sistema React funcionando 🚀</p> </div>
);
}
