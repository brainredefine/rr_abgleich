"use client";
import { useEffect, useState } from "react";

type AssetData = {
  reference_id: string;
  gla: number;
  rent: number;
  walt?: number;
};

export default function ComparePage() {
  const [odooData, setOdooData] = useState<AssetData[] | null>(null);
  const [pmData, setPmData] = useState<AssetData[] | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch("/compare/api");
        const json = await res.json();
        setOdooData(json.odoo || []);
        setPmData(json.pm || []);
      } catch (err) {
        console.error("Erreur chargement données :", err);
      }
    }
    fetchData();
  }, []);

  if (!odooData || !pmData) {
    return <div className="p-8 text-white">Chargement…</div>;
  }

  return (
    <main className="min-h-screen bg-black text-white p-8">
      <h1 className="text-3xl font-bold mb-6">Comparaison Odoo vs PM</h1>
      <table className="min-w-full border border-gray-700 text-sm">
  <thead className="bg-gray-800 text-gray-300">
    <tr>
      <th className="px-3 py-2 border border-gray-700">Asset</th>
      <th className="px-3 py-2 border border-gray-700">GLA (Odoo)</th>
      <th className="px-3 py-2 border border-gray-700">GLA (PM)</th>
      <th className="px-3 py-2 border border-gray-700">Δ GLA</th>
      <th className="px-3 py-2 border border-gray-700">Rent (Odoo)</th>
      <th className="px-3 py-2 border border-gray-700">Rent (PM)</th>
      <th className="px-3 py-2 border border-gray-700">Δ Rent</th>
      <th className="px-3 py-2 border border-gray-700">WALT (Odoo, yrs)</th>
      <th className="px-3 py-2 border border-gray-700">WALT (PM, yrs)</th>
      <th className="px-3 py-2 border border-gray-700">Δ WALT</th>
    </tr>
  </thead>
  <tbody>
    {odooData.map((odooAsset) => {
      const pmAsset = pmData.find((p) => p.reference_id === odooAsset.reference_id);

      const glaDelta = pmAsset ? odooAsset.gla - pmAsset.gla : null;
      const rentDelta = pmAsset ? odooAsset.rent - pmAsset.rent : null;
      const waltDelta = pmAsset && typeof pmAsset.walt === "number"
        ? (odooAsset.walt ?? 0) - (pmAsset.walt ?? 0)
        : null;

      const glaDisplay =
        glaDelta === null ? "-" : Math.abs(glaDelta) < 1 ? "-" : glaDelta.toLocaleString();
      const rentDisplay =
        rentDelta === null ? "-" : Math.abs(rentDelta) < 5 ? "-" : rentDelta.toLocaleString();
        const waltDeltaDisplay =
        waltDelta === null ? "-" : Math.abs(waltDelta) < 0.2 ? "-" : waltDelta.toFixed(2);

        const fmtYears = (v?: number) =>
        typeof v === "number" ? v.toFixed(2) : "-";

      return (
        <tr key={odooAsset.reference_id} className="border-t border-gray-700">
          <td className="px-3 py-2">{odooAsset.reference_id}</td>

          <td className="px-3 py-2 text-right">{odooAsset.gla.toLocaleString()}</td>
          <td className="px-3 py-2 text-right">{pmAsset?.gla?.toLocaleString() ?? "-"}</td>
          <td className="px-3 py-2 text-right">{glaDisplay}</td>

          <td className="px-3 py-2 text-right">{odooAsset.rent.toLocaleString()}</td>
          <td className="px-3 py-2 text-right">{pmAsset?.rent?.toLocaleString() ?? "-"}</td>
          <td className="px-3 py-2 text-right">{rentDisplay}</td>

          <td className="px-3 py-2 text-right">{fmtYears(odooAsset.walt)}</td>
          <td className="px-3 py-2 text-right">{fmtYears(pmAsset?.walt)}</td>
          <td className="px-3 py-2 text-right">{waltDeltaDisplay}</td>
          <td className="px-3 py-2 text-right">
          </td>
        </tr>
      );
    })}
  </tbody>
</table>
    </main>
  );
}
