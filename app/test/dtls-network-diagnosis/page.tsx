import { ShieldCheck } from "lucide-react";

export default function DtlsNetworkDiagnosisPage() {
  return (
    <section className="mx-auto max-w-6xl">
      <div className="mb-6 rounded-2xl border border-[#ede9f8] bg-white p-6 shadow-sm dark:border-white/[0.06] dark:bg-[#18181e]">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-sm">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[#0f0e1a] dark:text-[#f1f0f6]">
              DTLS Network Diagnosis
            </h1>
            <p className="mt-1 text-sm leading-6 text-[#6e6a85] dark:text-[#a7a4b5]">
              Diagnose browser capabilities, network paths, and conditions that can prevent a WebRTC DTLS handshake from completing.
            </p>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#ede9f8] bg-[#faf9ff] shadow-sm dark:border-white/[0.06] dark:bg-[#0e0e12]">
        <iframe
          title="DTLS network diagnosis tool"
          src="/dtls-network-diagnosis.html"
          className="block h-[calc(100vh-17rem)] min-h-[720px] w-full border-0"
        />
      </div>
    </section>
  );
}
