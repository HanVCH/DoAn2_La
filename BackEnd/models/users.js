export const safeUser = row => ({ id: String(row.id ?? row.user_id), email: row.email, phone: row.phone ?? null, ...(row.display_name !== undefined ? { display_name: row.display_name } : {}) });
