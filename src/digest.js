import { getConfirmedSubscribers, getPostsInRange, reserveDigestWeek, updateDigestStats } from "./db.js";
import { sendWeeklyDigest } from "./email.js";

const MONTHS_PT = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

// Rolls `now` back to the most recent Monday 00:00 UTC, then returns the
// 7-day window ending there — i.e. the previous Monday-to-Sunday week.
export function getPreviousWeekRange(now) {
  const thisMonday = new Date(now);
  thisMonday.setUTCHours(0, 0, 0, 0);
  const daysSinceMonday = (thisMonday.getUTCDay() + 6) % 7;
  thisMonday.setUTCDate(thisMonday.getUTCDate() - daysSinceMonday);

  const lastMonday = new Date(thisMonday);
  lastMonday.setUTCDate(thisMonday.getUTCDate() - 7);

  return { since: lastMonday, until: thisMonday };
}

export function formatWeekLabel(since) {
  const sunday = new Date(since);
  sunday.setUTCDate(since.getUTCDate() + 6);

  const startDay = String(since.getUTCDate()).padStart(2, "0");
  const endDay = String(sunday.getUTCDate()).padStart(2, "0");
  const startMonth = MONTHS_PT[since.getUTCMonth()];
  const endMonth = MONTHS_PT[sunday.getUTCMonth()];

  if (startMonth === endMonth) {
    return `${startDay} a ${endDay} de ${endMonth}`;
  }
  return `${startDay} de ${startMonth} a ${endDay} de ${endMonth}`;
}

export async function sendPendingDigest(env, now = new Date()) {
  const { since, until } = getPreviousWeekRange(now);
  const sinceIso = since.toISOString();
  const untilIso = until.toISOString();
  const weekStart = sinceIso.slice(0, 10);

  const posts = await getPostsInRange(env.DB, sinceIso, untilIso);
  if (posts.length === 0) {
    console.log(`Nenhum post entre ${sinceIso} e ${untilIso} — resumo não enviado.`);
    return { status: "no-posts", weekStart };
  }

  const reserved = await reserveDigestWeek(env.DB, weekStart, now.toISOString());
  if (!reserved) {
    console.log(`Resumo da semana ${weekStart} já foi enviado.`);
    return { status: "already-sent", weekStart };
  }

  const subscribers = await getConfirmedSubscribers(env.DB);
  const weekLabel = formatWeekLabel(since);
  const workerOrigin = env.WORKER_URL;
  let sent = 0;

  for (const sub of subscribers) {
    try {
      await sendWeeklyDigest(env, sub.email, `${workerOrigin}/unsubscribe?token=${sub.unsubscribe_token}`, posts, weekLabel);
      sent += 1;
    } catch (err) {
      console.error(`Falha ao enviar resumo pra ${sub.email}: ${err.message}`);
    }
  }

  await updateDigestStats(env.DB, weekStart, sent, posts.length);

  if (sent === 0 && subscribers.length > 0) {
    return { status: "send-failed", weekStart, recipients: 0, posts: posts.length };
  }

  return { status: "sent", weekStart, recipients: sent, posts: posts.length };
}
