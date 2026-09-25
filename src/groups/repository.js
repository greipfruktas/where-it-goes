function unwrap(result) {
  if (result?.error) throw new Error(result.error.message);
  return result?.data;
}

async function getCurrentUser(client) {
  const user = unwrap(await client.auth.getUser())?.user;
  if (!user) throw new Error("Authentication required");
  return user;
}

function expensePayload(draft) {
  return {
    group_id: draft.groupId,
    expense_id: draft.expenseId ?? draft.id,
    idempotency_key: draft.idempotencyKey,
    amount_minor: draft.amountMinor,
    payer_id: draft.payerId,
    participant_shares: draft.participantShares?.map((share) => ({
      member_id: share.memberId,
      share_minor: share.shareMinor
    })),
    description: draft.description,
    category: draft.category,
    expense_date: draft.expenseDate ?? draft.date,
    currency: draft.currency
  };
}

function repaymentPayload(draft) {
  return {
    group_id: draft.groupId,
    idempotency_key: draft.idempotencyKey,
    payer_id: draft.payerId,
    recipient_id: draft.recipientId,
    amount_minor: draft.amountMinor,
    repayment_date: draft.repaymentDate ?? draft.date
  };
}

function groupPayload(draft) {
  return {
    name: draft.name,
    icon: draft.icon,
    currency: draft.currency,
    starts_on: draft.startsOn,
    ends_on: draft.endsOn
  };
}

function inviteExpiry(expiresAt) {
  if (expiresAt) return expiresAt;
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
}

function createInviteToken() {
  if (!globalThis.crypto?.getRandomValues || !globalThis.crypto?.subtle) {
    throw new Error("Secure browser cryptography is unavailable");
  }
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashInviteToken(token) {
  const bytes = new TextEncoder().encode(token);
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `\\x${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Browser persistence boundary for shared groups. Financial history is read
 * directly under RLS, but every financial mutation is delegated to an RPC.
 */
export function createGroupsRepository(client) {
  return {
    async listGroups() {
      return unwrap(await client
        .from("groups")
        .select("*, group_members(*), group_invites(*)")
        .order("created_at", { ascending: false }));
    },

    async getGroup(groupId) {
      return unwrap(await client
        .from("groups")
        .select("*, group_members(*, profiles(*)), group_invites(*), group_expenses(*, expense_participants(*)), group_repayments(*)")
        .eq("id", groupId)
        .single());
    },

    async createGroup(draft) {
      const user = await getCurrentUser(client);
      const group = unwrap(await client
        .from("groups")
        .insert({ ...groupPayload(draft), owner_id: user.id })
        .select()
        .single());
      await unwrap(await client
        .from("group_members")
        .insert({ group_id: group.id, user_id: user.id, role: "owner", status: "active" }));
      return group;
    },

    async joinGroup(token) {
      return unwrap(await client.rpc("join_group", { p_token: token }));
    },

    async saveExpense(draft) {
      return unwrap(await client.rpc("save_group_expense", { payload: expensePayload(draft) }));
    },

    async updateExpense(draft) {
      return unwrap(await client.rpc("update_group_expense", { payload: expensePayload(draft) }));
    },

    async deleteExpense(expenseId) {
      return unwrap(await client.rpc("delete_group_expense", { p_expense_id: expenseId }));
    },

    async saveRepayment(draft) {
      return unwrap(await client.rpc("save_group_repayment", { payload: repaymentPayload(draft) }));
    },

    async archiveGroup(groupId) {
      return unwrap(await client
        .from("groups")
        .update({ status: "archived", archived_at: new Date().toISOString() })
        .eq("id", groupId)
        .select()
        .single());
    },

    async reopenGroup(groupId) {
      return unwrap(await client
        .from("groups")
        .update({ status: "active", archived_at: null })
        .eq("id", groupId)
        .select()
        .single());
    },

    async removeMember(groupId, memberId) {
      return unwrap(await client
        .from("group_members")
        .update({ status: "removed", removed_at: new Date().toISOString() })
        .eq("group_id", groupId)
        .eq("user_id", memberId)
        .select()
        .single());
    },

    async transferOwnership(groupId, newOwnerId) {
      return unwrap(await client.rpc("transfer_group_ownership", {
        p_group_id: groupId,
        p_new_owner_id: newOwnerId
      }));
    },

    async rotateInvite(groupId, expiresAt) {
      await unwrap(await client
        .from("group_invites")
        .update({ is_active: false, revoked_at: new Date().toISOString() })
        .eq("group_id", groupId)
        .eq("is_active", true));
      const user = await getCurrentUser(client);
      const token = createInviteToken();
      const invite = unwrap(await client
        .from("group_invites")
        .insert({
          group_id: groupId,
          created_by: user.id,
          token_hash: await hashInviteToken(token),
          expires_at: inviteExpiry(expiresAt),
          is_active: true
        })
        .select()
        .single());
      return { ...invite, token };
    },

    async disableInvite(inviteId) {
      return unwrap(await client
        .from("group_invites")
        .update({ is_active: false, revoked_at: new Date().toISOString() })
        .eq("id", inviteId)
        .select()
        .single());
    },

    subscribeToGroup(groupId, onChange, onStatus) {
      const channel = client.channel(`group:${groupId}`);
      channel
        .on("postgres_changes", { event: "*", schema: "public", table: "groups", filter: `id=eq.${groupId}` }, onChange)
        .on("postgres_changes", { event: "*", schema: "public", table: "group_members", filter: `group_id=eq.${groupId}` }, onChange)
        .on("postgres_changes", { event: "*", schema: "public", table: "group_invites", filter: `group_id=eq.${groupId}` }, onChange)
        .on("postgres_changes", { event: "*", schema: "public", table: "group_expenses", filter: `group_id=eq.${groupId}` }, onChange)
        .on("postgres_changes", { event: "*", schema: "public", table: "expense_participants", filter: `group_id=eq.${groupId}` }, onChange)
        .on("postgres_changes", { event: "*", schema: "public", table: "group_repayments", filter: `group_id=eq.${groupId}` }, onChange);
      return channel.subscribe(onStatus);
    }
  };
}
