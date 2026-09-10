export async function getSubscriberByEmail(db, email) {
  const row = await db.prepare("SELECT * FROM subscribers WHERE email = ?").bind(email).first();
  return row ?? null;
}

export async function insertPendingSubscriber(db, email, confirmToken, unsubscribeToken, now) {
  await db
    .prepare(
      `INSERT INTO subscribers (email, status, confirm_token, unsubscribe_token, created_at)
       VALUES (?, 'pending', ?, ?, ?)`
    )
    .bind(email, confirmToken, unsubscribeToken, now)
    .run();
}

export async function reopenAsPending(db, email, confirmToken, now) {
  await db
    .prepare(
      `UPDATE subscribers
       SET status = 'pending', confirm_token = ?, confirmed_at = NULL, created_at = ?
       WHERE email = ?`
    )
    .bind(confirmToken, now, email)
    .run();
}

export async function confirmByToken(db, token, now) {
  const result = await db
    .prepare(
      `UPDATE subscribers SET status = 'confirmed', confirmed_at = ?
       WHERE confirm_token = ? AND status = 'pending'`
    )
    .bind(now, token)
    .run();
  return result.meta.changes > 0;
}

export async function unsubscribeByToken(db, token) {
  const result = await db
    .prepare("UPDATE subscribers SET status = 'unsubscribed' WHERE unsubscribe_token = ?")
    .bind(token)
    .run();
  return result.meta.changes > 0;
}

export async function getConfirmedSubscribers(db) {
  const { results } = await db
    .prepare("SELECT email, unsubscribe_token FROM subscribers WHERE status = 'confirmed'")
    .all();
  return results;
}

export async function hasSentCampaign(db, slug) {
  const row = await db.prepare("SELECT slug FROM sent_campaigns WHERE slug = ?").bind(slug).first();
  return row != null;
}

export async function recordSentCampaign(db, slug, now, recipientCount) {
  await db
    .prepare("INSERT INTO sent_campaigns (slug, sent_at, recipient_count) VALUES (?, ?, ?)")
    .bind(slug, now, recipientCount)
    .run();
}

// Atomically reserves a slug for sending before any emails go out, so two
// overlapping /admin/send calls for the same slug can't both send. Returns
// true if this call won the reservation (i.e. should proceed to send),
// false if the slug was already reserved/sent by a previous call.
export async function reserveCampaign(db, slug, now) {
  const result = await db
    .prepare("INSERT OR IGNORE INTO sent_campaigns (slug, sent_at, recipient_count) VALUES (?, ?, 0)")
    .bind(slug, now)
    .run();
  return result.meta.changes > 0;
}

export async function updateCampaignRecipientCount(db, slug, recipientCount) {
  await db
    .prepare("UPDATE sent_campaigns SET recipient_count = ? WHERE slug = ?")
    .bind(recipientCount, slug)
    .run();
}
