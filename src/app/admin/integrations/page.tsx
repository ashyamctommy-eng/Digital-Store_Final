"use client";
import { useState } from "react";
import { useStore } from "@/lib/browserStore";

const CURRENCY_KEY = "riotgear_currency";
const currencies = [
  { code: "USD", symbol: "$", name: "US Dollar", rate: 1 },
  { code: "KES", symbol: "KSh", name: "Kenyan Shilling", rate: 129.5 },
  { code: "NGN", symbol: "\u20A6", name: "Nigerian Naira", rate: 1550 },
  { code: "ZAR", symbol: "R", name: "South African Rand", rate: 18.2 },
  { code: "GHS", symbol: "GH\u20B5", name: "Ghanaian Cedi", rate: 15.8 },
  { code: "TZS", symbol: "TSh", name: "Tanzanian Shilling", rate: 2650 },
  { code: "GBP", symbol: "\u00A3", name: "British Pound", rate: 0.79 },
  { code: "EUR", symbol: "\u20AC", name: "Euro", rate: 0.92 },
];

export function getCurrency() {
  return currencies[0];
}

export function convertPrice(usdPrice: number): { value: number; display: string } {
  const cur = getCurrency();
  const converted = usdPrice * cur.rate;
  return { value: converted, display: `${cur.symbol}${converted.toFixed(cur.rate >= 100 ? 0 : 2)}` };
}

export default function IntegrationsPage() {
  const [activeCurrency, setActiveCurrency] = useStore<string>(CURRENCY_KEY, "KES");
  const [mpesa, setMpesa] = useState({ shortcode: "174379", consumerKey: "sDnAFGR...", consumerSecret: "GJXhF6f...", callbackUrl: "https://example.com/api/mpesa/callback", mode: "sandbox" });
  const [paystack, setPaystack] = useState({ publicKey: "pk_test_xxx", secretKey: "sk_test_xxx", currency: "NGN", mode: "test" });
  const [flutterwave, setFlutterwave] = useState({ publicKey: "FLWPUBK_TEST-xxx", secretKey: "FLWSECK_TEST-xxx", encryptionKey: "FLWSECK_TESTxxx", currency: "NGN", mode: "test" });
  const [whatsapp, setWhatsapp] = useState({ phone: "+254717702563", businessName: "Digital Hub Shop" });
  const [saved, setSaved] = useState("");

  const save = (n: string) => { setSaved(n); setTimeout(() => setSaved(""), 2000); };
  const handleCurrencyChange = (code: string) => { setActiveCurrency(code); save("currency"); };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Integrations</h1>
      <p className="text-sm text-gray-500 mb-4">Payment gateways, messaging &amp; global currency</p>
      <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-500/25 dark:bg-amber-500/10 p-3 text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed max-w-3xl">These fields are not yet connected to live gateways. Checkout currently runs on wallet, M-Pesa and WhatsApp confirmation. Wire a provider (or a small backend) before switching to live keys.</div>
      <div className="space-y-6">
        {/* Global Currency */}
        <div className="bg-white rounded-lg border p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-[var(--color-gold)] flex items-center justify-center text-white font-bold text-lg">$</div>
            <div><h2 className="font-bold text-sm">Global Currency</h2><p className="text-[10px] text-gray-500">All product prices convert to this currency</p></div>
            <span className="ml-auto text-xs font-bold px-3 py-1 rounded bg-amber-50 text-amber-700">{activeCurrency}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {currencies.map(c => (
              <button key={c.code} onClick={() => handleCurrencyChange(c.code)} className={`border rounded p-3 text-left transition-all ${activeCurrency === c.code ? "border-[var(--color-gold)] bg-amber-50 ring-1 ring-[var(--color-gold)]" : "border-gray-200 hover:border-gray-400"}`}>
                <p className="text-sm font-bold">{c.symbol} {c.code}</p>
                <p className="text-[9px] text-gray-500 mt-0.5">{c.name}</p>
                <p className="text-[9px] text-gray-400 mt-0.5">1 USD = {c.rate}</p>
              </button>
            ))}
          </div>
          {saved === "currency" && <p className="text-xs text-green-600 font-bold mt-3">Currency updated! Prices reflect on storefront.</p>}
        </div>
        {/* M-Pesa */}
        <div className="bg-white rounded-lg border p-6">
          <div className="flex items-center gap-3 mb-4"><div className="w-10 h-10 rounded-lg bg-[#49B642] flex items-center justify-center text-white font-black text-lg">M</div><div><h2 className="font-bold text-sm">M-Pesa (Safaricom)</h2><p className="text-[10px] text-gray-500">STK Push for Kenya/Tanzania</p></div><span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded ${mpesa.mode==="sandbox"?"bg-amber-100 text-amber-700":"bg-green-100 text-green-700"}`}>{mpesa.mode}</span></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><div><label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">Shortcode</label><input value={mpesa.shortcode} onChange={e=>setMpesa({...mpesa,shortcode:e.target.value})} className="w-full border px-3 py-2 text-sm" /></div><div><label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">Consumer Key</label><input value={mpesa.consumerKey} onChange={e=>setMpesa({...mpesa,consumerKey:e.target.value})} className="w-full border px-3 py-2 text-sm" type="password" /></div><div><label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">Consumer Secret</label><input value={mpesa.consumerSecret} onChange={e=>setMpesa({...mpesa,consumerSecret:e.target.value})} className="w-full border px-3 py-2 text-sm" type="password" /></div><div><label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">Callback URL</label><input value={mpesa.callbackUrl} onChange={e=>setMpesa({...mpesa,callbackUrl:e.target.value})} className="w-full border px-3 py-2 text-sm" /></div><div><label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">Mode</label><select value={mpesa.mode} onChange={e=>setMpesa({...mpesa,mode:e.target.value})} className="w-full border px-3 py-2 text-sm"><option value="sandbox">Sandbox</option><option value="production">Production</option></select></div></div>
          <button onClick={()=>save("mpesa")} className="mt-4 bg-[#49B642] text-white px-4 py-2 text-xs font-bold uppercase hover:bg-[#3da636]">{saved==="mpesa"?"Saved!":"Save M-Pesa"}</button>
        </div>
        {/* Flutterwave */}
        <div className="bg-white rounded-lg border p-6">
          <div className="flex items-center gap-3 mb-4"><div className="w-10 h-10 rounded-lg bg-[#F5A623] flex items-center justify-center text-white font-bold text-sm">FW</div><div><h2 className="font-bold text-sm">Flutterwave</h2><p className="text-[10px] text-gray-500">Cards, Mobile Money, Bank Transfer — Africa & Global</p></div><span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded ${flutterwave.mode==="test"?"bg-amber-100 text-amber-700":"bg-green-100 text-green-700"}`}>{flutterwave.mode}</span></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><div><label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">Public Key</label><input value={flutterwave.publicKey} onChange={e=>setFlutterwave({...flutterwave,publicKey:e.target.value})} className="w-full border px-3 py-2 text-sm" /></div><div><label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">Secret Key</label><input value={flutterwave.secretKey} onChange={e=>setFlutterwave({...flutterwave,secretKey:e.target.value})} className="w-full border px-3 py-2 text-sm" type="password" /></div><div><label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">Encryption Key</label><input value={flutterwave.encryptionKey} onChange={e=>setFlutterwave({...flutterwave,encryptionKey:e.target.value})} className="w-full border px-3 py-2 text-sm" type="password" /></div><div><label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">Currency</label><select value={flutterwave.currency} onChange={e=>setFlutterwave({...flutterwave,currency:e.target.value})} className="w-full border px-3 py-2 text-sm"><option value="NGN">NGN</option><option value="KES">KES</option><option value="ZAR">ZAR</option><option value="GHS">GHS</option><option value="TZS">TZS</option><option value="USD">USD</option></select></div><div><label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">Mode</label><select value={flutterwave.mode} onChange={e=>setFlutterwave({...flutterwave,mode:e.target.value})} className="w-full border px-3 py-2 text-sm"><option value="test">Test</option><option value="live">Live</option></select></div></div>
          <button onClick={()=>save("flutterwave")} className="mt-4 bg-[#F5A623] text-white px-4 py-2 text-xs font-bold uppercase hover:bg-[#d48f1a]">{saved==="flutterwave"?"Saved!":"Save Flutterwave"}</button>
        </div>
        {/* Paystack */}
        <div className="bg-white rounded-lg border p-6">
          <div className="flex items-center gap-3 mb-4"><div className="w-10 h-10 rounded-lg bg-[#09A5DB] flex items-center justify-center text-white font-bold text-sm">PS</div><div><h2 className="font-bold text-sm">Paystack</h2><p className="text-[10px] text-gray-500">Cards for Nigeria/SA/Ghana</p></div><span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded ${paystack.mode==="test"?"bg-amber-100 text-amber-700":"bg-green-100 text-green-700"}`}>{paystack.mode}</span></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><div><label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">Public Key</label><input value={paystack.publicKey} onChange={e=>setPaystack({...paystack,publicKey:e.target.value})} className="w-full border px-3 py-2 text-sm" /></div><div><label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">Secret Key</label><input value={paystack.secretKey} onChange={e=>setPaystack({...paystack,secretKey:e.target.value})} className="w-full border px-3 py-2 text-sm" type="password" /></div><div><label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">Currency</label><select value={paystack.currency} onChange={e=>setPaystack({...paystack,currency:e.target.value})} className="w-full border px-3 py-2 text-sm"><option value="NGN">NGN</option><option value="ZAR">ZAR</option><option value="GHS">GHS</option><option value="USD">USD</option></select></div><div><label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">Mode</label><select value={paystack.mode} onChange={e=>setPaystack({...paystack,mode:e.target.value})} className="w-full border px-3 py-2 text-sm"><option value="test">Test</option><option value="live">Live</option></select></div></div>
          <button onClick={()=>save("paystack")} className="mt-4 bg-[#09A5DB] text-white px-4 py-2 text-xs font-bold uppercase hover:bg-[#0890bf]">{saved==="paystack"?"Saved!":"Save Paystack"}</button>
        </div>
        {/* WhatsApp */}
        <div className="bg-white rounded-lg border p-6">
          <div className="flex items-center gap-3 mb-4"><div className="w-10 h-10 rounded-lg bg-[#25D366] flex items-center justify-center text-white font-bold">WA</div><div><h2 className="font-bold text-sm">WhatsApp Checkout</h2><p className="text-[10px] text-gray-500">Order messaging to seller</p></div><span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded bg-green-100 text-green-700">active</span></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><div><label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">Seller Phone</label><input value={whatsapp.phone} onChange={e=>setWhatsapp({...whatsapp,phone:e.target.value})} className="w-full border px-3 py-2 text-sm" /></div><div><label className="block text-[10px] font-bold uppercase text-gray-500 mb-1">Business Name</label><input value={whatsapp.businessName} onChange={e=>setWhatsapp({...whatsapp,businessName:e.target.value})} className="w-full border px-3 py-2 text-sm" /></div></div>
          <button onClick={()=>save("whatsapp")} className="mt-4 bg-[#25D366] text-white px-4 py-2 text-xs font-bold uppercase hover:bg-[#1da851]">{saved==="whatsapp"?"Saved!":"Save WhatsApp"}</button>
        </div>
      </div>
    </div>
  );
}
