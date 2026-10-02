function unwrap(result, fallback = null) {
  if (result?.error) throw new Error(result.error.message || "Personal sync failed");
  return result?.data ?? fallback;
}

function expenseFromRow(row) {
  return {
    id: row.expense_id,
    amount: row.amount_minor == null ? null : row.amount_minor / 100,
    category: row.category,
    labels: row.labels || [],
    reimbursementPercent: row.reimbursement_percent || 0,
    date: row.expense_date,
    note: row.note || "",
    createdAt: row.created_at_client,
    deletedAt: row.deleted_at,
    serverUpdatedAt: row.updated_at
  };
}

export function createPersonalRepository(client) {
  return {
    async pull(userId) {
      const expensesResult = await client.from("personal_expenses").select("*").eq("owner_id", userId);
      const settingsResult = await client.from("personal_settings").select("categories, style, import_rules, updated_at").eq("owner_id", userId).maybeSingle();
      const settings = unwrap(settingsResult, null);
      return {
        expenses: unwrap(expensesResult, []).map(expenseFromRow),
        settings: settings ? { categories: settings.categories, style: settings.style, importRules: Array.isArray(settings.import_rules) ? settings.import_rules : [] } : null
      };
    },
    async apply(operation) {
      return unwrap(await client.rpc("apply_personal_operation", { payload: operation }), false);
    },
    subscribe(userId, onChange, onStatus = () => {}) {
      const channel = client.channel(`personal:${userId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "personal_expenses", filter: `owner_id=eq.${userId}` }, onChange)
        .on("postgres_changes", { event: "*", schema: "public", table: "personal_settings", filter: `owner_id=eq.${userId}` }, onChange)
        .subscribe(onStatus);
      return { unsubscribe: () => client.removeChannel(channel) };
    }
  };
}
