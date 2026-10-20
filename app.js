// ====== EDIT THESE after deploying to Sepolia ======
// Your two assignment tokens. They are always shown, even if the indexer is slow.
const MY_TOKENS = [
  "0x9D76CeA4e53Bdb277ecaF83E823781b0f2d4b7D8",
];
// ===================================================

const SEPOLIA_ID = 11155111n;
const SEPOLIA_HEX = "0xaa36a7";
// Public, keyless indexer used only to DISCOVER which tokens a wallet holds.
// Balances themselves are always read directly from the blockchain.
const INDEXER = "https://eth-sepolia.blockscout.com/api/v2/addresses/";
const ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
];

const $ = (id) => document.getElementById(id);
let provider, signer, account;
let tokens = {}; // tokens[lowercaseAddress] = {contract, name, symbol, decimals, address}

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

// Ask the indexer which ERC-20 contracts this wallet holds.
async function discoverTokenAddresses() {
  const found = [];
  try {
    const res = await fetch(INDEXER + account + "/token-balances");
    if (!res.ok) throw new Error("indexer " + res.status);
    const list = await res.json();
    for (const item of list) {
      const t = item.token || {};
      const addr = t.address_hash || t.address;
      if (addr && (!t.type || t.type === "ERC-20") && ethers.isAddress(addr)) found.push(addr);
    }
  } catch (e) {
    setStatus("Could not load the full token list; showing your assignment tokens only.", "err");
  }
  return found;
}

async function readToken(address) {
  try {
    const c = new ethers.Contract(address, ABI, signer);
    const [name, symbol, decimals, raw] = await Promise.all([
      c.name().catch(() => ""), c.symbol(), c.decimals(), c.balanceOf(account),
    ]);
    return { contract: c, name, symbol, decimals, raw, address };
  } catch (e) {
    return null; // not a standard ERC-20, skip it
  }
}

function renderTokens(list) {
  const box = $("tokens");
  box.replaceChildren();
  for (const t of list) {
    const card = document.createElement("div");
    card.className = "panel coin";
    const sym = document.createElement("div"); sym.className = "sym"; sym.textContent = t.symbol;
    const nm = document.createElement("div"); nm.className = "name"; nm.textContent = t.name;
    const bal = document.createElement("div"); bal.className = "bal"; bal.textContent = ethers.formatUnits(t.raw, t.decimals);
    const ad = document.createElement("div"); ad.className = "meta"; ad.textContent = t.address;
    card.append(sym, nm, bal, ad);
    box.append(card);
  }
  if (!list.length) box.innerHTML = '<div class="panel">No tokens found.</div>';
}

async function loadBalances() {
  const addrs = new Map();
  for (const a of MY_TOKENS) if (ethers.isAddress(a)) addrs.set(a.toLowerCase(), a);
  for (const a of await discoverTokenAddresses()) if (!addrs.has(a.toLowerCase())) addrs.set(a.toLowerCase(), a);

  const results = (await Promise.all([...addrs.values()].map(readToken))).filter(Boolean);
  // Keep tokens you hold, plus your assignment tokens even at zero balance.
  const mine = new Set(MY_TOKENS.map((a) => a.toLowerCase()));
  const shown = results.filter((t) => t.raw > 0n || mine.has(t.address.toLowerCase()));
  shown.sort((a, b) => (mine.has(b.address.toLowerCase()) ? 1 : 0) - (mine.has(a.address.toLowerCase()) ? 1 : 0));

  tokens = {};
  const sel = $("token");
  sel.replaceChildren();
  for (const t of shown) {
    tokens[t.address.toLowerCase()] = t;
    sel.add(new Option(t.symbol, t.address.toLowerCase()));
  }
  renderTokens(shown);
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
    if (await checkNetwork()) { setStatus("Loading tokens..."); await loadBalances(); if ($("status").className !== "err") setStatus("Connected."); }
  } catch (e) { showError(e); }
}

async function send() {
  try {
    if (!(await checkNetwork())) throw new Error("Wrong network. Switch to Ethereum Sepolia.");
    const t = tokens[$("token").value];
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
