// API gửi email báo cáo ngày.
// - Vercel Cron gọi mỗi tối (xem vercel.json), kèm header Authorization: Bearer CRON_SECRET
// - Admin bấm "Gửi thử" trong trang Cài đặt, kèm Firebase ID token
import admin from 'firebase-admin';
import nodemailer from 'nodemailer';
import { buildReport } from '../src/lib/report.js';
import { fmtDate, vnDate } from '../src/lib/utils.js';
import { renderEmail } from './_lib/email.js';

function getApp() {
  if (!admin.apps.length) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
    if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, '\n');
    admin.initializeApp({ credential: admin.credential.cert(sa) });
  }
  return admin.app();
}

const SUPER = (process.env.SUPER_ADMINS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

async function authorize(req, db) {
  const h = req.headers.authorization || '';
  const token = h.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  if (process.env.CRON_SECRET && token === process.env.CRON_SECRET) return 'cron';
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    if (!decoded.email_verified) return null;
    const email = (decoded.email || '').toLowerCase();
    if (SUPER.includes(email)) return 'admin';
    const s = await db.collection('staff').doc(email).get();
    if (s.exists && s.data().role === 'admin' && s.data().active !== false) return 'admin';
  } catch (e) {
    console.error('verifyIdToken', e.message);
  }
  return null;
}

const list = async (q) => (await q.get()).docs.map((d) => ({ id: d.id, ...d.data() }));

export default async function handler(req, res) {
  try {
    getApp();
    const db = admin.firestore();
    const who = await authorize(req, db);
    if (!who) return res.status(401).json({ error: 'Không có quyền' });

    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query?.date || '') ? req.query.date : vnDate();
    const cfgSnap = await db.collection('settings').doc('config').get();
    const config = { companyName: 'Công ty', customFields: {}, reportRecipients: [], ...(cfgSnap.exists ? cfgSnap.data() : {}) };

    if (who === 'cron' && config.reportEnabled === false) return res.json({ skipped: 'Đã tắt gửi tự động' });
    const recipients = (config.reportRecipients || []).filter(Boolean);
    if (!recipients.length) return res.status(400).json({ error: 'Chưa có email nhận báo cáo trong Cài đặt' });

    const byDate = (c, field = 'date') => list(db.collection(c).where(field, '==', date));
    const [activities, orders, payments, notes, customers, tasks, staffList] = await Promise.all([
      byDate('activities'), byDate('orders'), byDate('payments'), byDate('dailyNotes'),
      byDate('customers', 'createdDate'), list(db.collection('tasks')),
      (await db.collection('staff').get()).docs.map((d) => ({ email: d.id, ...d.data() })),
    ]);

    const rep = buildReport({ activities, orders, payments, tasks, notes, customers, staffList, from: date, to: date });
    const html = renderEmail({
      rep, date, config, appUrl: process.env.APP_URL,
      data: { activities, orders, payments, notes, tasks, staffList },
    });

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await transporter.sendMail({
      from: `"Báo cáo Sale - ${config.companyName}" <${process.env.SMTP_USER}>`,
      to: recipients.join(','),
      subject: `[Báo cáo Sale] Ngày ${fmtDate(date)} — ${rep.total.orders || 0} đơn chốt, ${rep.total.activities || 0} hoạt động`,
      html,
    });

    await db.collection('reportLogs').add({ date, sentTo: recipients, by: who, at: admin.firestore.FieldValue.serverTimestamp() });
    return res.json({ ok: true, date, sentTo: recipients });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}
