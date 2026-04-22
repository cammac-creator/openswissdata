import { parseCsv } from "./helpers/csv.js";

export interface FinmaEntity {
  entity_type: string;
  name: string;
  uid?: string;
  lei?: string;
  licence_type?: string;
  licence_date?: string;
  status?: string;
  canton?: string;
  address?: string;
  source_list: string;
  source_url: string;
}

export async function loadFinmaRegistry(csvPath: string): Promise<FinmaEntity[]> {
  const rows = await parseCsv(csvPath);
  return rows.map(r => ({
    entity_type: String(r.entity_type),
    name: String(r.name),
    uid: r.uid ? String(r.uid) : undefined,
    lei: r.lei ? String(r.lei) : undefined,
    licence_type: r.licence_type ? String(r.licence_type) : undefined,
    licence_date: r.licence_date ? String(r.licence_date) : undefined,
    status: r.status ? String(r.status) : undefined,
    canton: r.canton ? String(r.canton) : undefined,
    address: r.address ? String(r.address) : undefined,
    source_list: String(r.source_list),
    source_url: String(r.source_url),
  }));
}
