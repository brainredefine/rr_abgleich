export interface AssetData {
  reference_id: string;
  gla: number;
  rent: number;
  walt?: number;
}



export interface TenantData {
  // Clé de comparaison: asset (reference_id) + nom tenant normalisé
  asset_ref: string;     // ex: "AA1"
  tenant_name: string;   // libellé affiché (après mapping)
  space: number;         // m² (Odoo: property.tenancy.space)
  rent: number;          // Odoo: total_current_rent
  walt?: number;         // années (diff today -> date_end_display)
  city?: string; 
}


export interface TenantMapping {
  pm: string; // motif côté PM (ex: "carrefour sa")
  am: string; // libellé cible (ex: "carrefour")
}

// Dictionnaire global = liste de règles
export type TenantMap = TenantMapping[];



