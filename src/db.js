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

export async function upsertPost(db, post, now) {
  await db
    .prepare(
      `INSERT INTO posts (slug, title, excerpt, url, category, date_iso, registered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(slug) DO UPDATE SET
         title = excluded.title,
         excerpt = excluded.excerpt,
         url = excluded.url,
         category = excluded.category,
         date_iso = excluded.date_iso,
         registered_at = excluded.registered_at`
    )
    .bind(post.slug, post.title, post.excerpt, post.url, post.category, post.dateISO, now)
    .run();
}

export async function getPostsInRange(db, sinceIso, untilIso) {
  const { results } = await db
    .prepare(
      `SELECT slug, title, excerpt, url, category, date_iso
       FROM posts WHERE date_iso >= ? AND date_iso < ? ORDER BY date_iso ASC`
    )
    .bind(sinceIso, untilIso)
    .all();
  return results;
}

// Atomically reserves a week for the digest before any emails go out, so an
// overlapping/re-triggered cron run for the same week can't send twice.
// Returns true if this call won the reservation, false if already sent.
export async function reserveDigestWeek(db, weekStart, now) {
  const result = await db
    .prepare("INSERT OR IGNORE INTO digest_log (week_start, sent_at, recipient_count, post_count) VALUES (?, ?, 0, 0)")
    .bind(weekStart, now)
    .run();
  return result.meta.changes > 0;
}

export async function updateDigestStats(db, weekStart, recipientCount, postCount) {
  await db
    .prepare("UPDATE digest_log SET recipient_count = ?, post_count = ? WHERE week_start = ?")
    .bind(recipientCount, postCount, weekStart)
    .run();
}

export async function countRecentAttempts(db, ip, sinceIso) {
  const row = await db
    .prepare("SELECT COUNT(*) as count FROM subscribe_attempts WHERE ip = ? AND created_at >= ?")
    .bind(ip, sinceIso)
    .first();
  return row.count;
}

export async function recordAttempt(db, ip, now) {
  await db
    .prepare("INSERT INTO subscribe_attempts (ip, created_at) VALUES (?, ?)")
    .bind(ip, now)
    .run();
}
