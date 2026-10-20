// ====== EDIT THESE after deploying to Sepolia ======
const TOKENS = [
  { key: "A", address: "0xYOUR_GOLD_COIN_ADDRESS" },
  { key: "B", address: "0xYOUR_SILVER_COIN_ADDRESS" },
];
// ===================================================

const SEPOLIA_ID = 11155111n;
const SEPOLIA_HEX = "0xaa36a7";
const ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
];

const $ = (id) => document.getElementById(id);
let provider, signer, account, info = {}; // info[key] = {contract, symbol, decimals, raw}

function setStatus(msg, cls = "") {
  const el = $("status");
  el.className = cls;
  el.textContent = msg;
}

function showError(e) {
  if (e && (e.code === "ACTION_REJECTED" || e.code === 4001)) {
    setStatus("Transaction cancelled in MetaMask. No tokens were sent.", "err");
  } else {
    setStatus(e.shortMessage || e.message || "Something went wrong.", "err");
  }
}

async function checkNetwork() {
  const net = await provider.getNetwork();
  const ok = net.chainId === SEPOLIA_ID;
  $("netWarn").hidden = ok;
  $("sendBtn").disabled = !ok || !account;
  return ok;
}

async function switchToSepolia() {
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: SEPOLIA_HEX }] });
  } catch (e) { /* user can switch manually; warning banner stays visible */ }
}

async function loadBalances() {
  for (const t of TOKENS) {
    try {
      if (!ethers.isAddress(t.address)) throw new Error("Set a valid token address in app.js");
      const c = new ethers.Contract(t.address, ABI, signer);
      const [symbol, decimals, raw] = await Promise.all([c.symbol(), c.decimals(), c.balanceOf(account)]);
      info[t.key] = { contract: c, symbol, decimals, raw, address: t.address };
      $("sym" + t.key).textContent = symbol;
      $("bal" + t.key).textContent = ethers.formatUnits(raw, decimals);
      $("addr" + t.key).textContent = t.address;
    } catch (e) {
      $("bal" + t.key).textContent = "n/a";
      setStatus("Could not read token " + t.key + ": " + (e.shortMessage || e.message), "err");
    }
  }
  const sel = $("token");
  if (!sel.options.length) {
    for (const t of TOKENS) if (info[t.key]) sel.add(new Option(info[t.key].symbol, t.key));
  }
}

async function connect() {
  if (!window.ethereum) { setStatus("MetaMask not found. Install it and reload.", "err"); return; }
  try {
    provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    if (!(await checkNetwork())) { await switchToSepolia(); provider = new ethers.BrowserProvider(window.ethereum); }
    signer = await provider.getSigner();
    account = await signer.getAddress();
    $("account").textContent = account;
    if (await checkNetwork()) { await loadBalances(); setStatus("Connected."); }
  } catch (e) { showError(e); }
}

async function send() {
  try {
    if (!(await checkNetwork())) throw new Error("Wrong network. Switch to Ethereum Sepolia.");
    const t = info[$("token").value];
    if (!t) throw new Error("Select a token.");
    const to = $("to").value.trim();
    if (!ethers.isAddress(to)) throw new Error("Invalid recipient address.");
    let amount;
    try { amount = ethers.parseUnits($("amount").value.trim(), t.decimals); }
    catch { throw new Error("Enter a valid amount, e.g. 1.0"); }
    if (amount <= 0n) throw new Error("Amount must be greater than zero.");
    const bal = await t.contract.balanceOf(account);
    if (amount > bal) throw new Error("Insufficient balance. You have " + ethers.formatUnits(bal, t.decimals) + " " + t.symbol + ".");

    $("sendBtn").disabled = true;
    setStatus("Confirm the transaction in MetaMask...");
    const tx = await t.contract.transfer(to, amount);
    setStatus("Waiting for confirmation: " + tx.hash);
    const receipt = await tx.wait();
    if (receipt.status !== 1) throw new Error("Transaction failed on-chain.");
    setStatus("Sent! https://sepolia.etherscan.io/tx/" + tx.hash, "ok");
    await loadBalances();
  } catch (e) { showError(e); }
  finally { $("sendBtn").disabled = !account; }
}

$("connectBtn").addEventListener("click", connect);
$("sendBtn").addEventListener("click", send);
if (window.ethereum) {
  window.ethereum.on("chainChanged", () => location.reload());
  window.ethereum.on("accountsChanged", () => location.reload());
}
