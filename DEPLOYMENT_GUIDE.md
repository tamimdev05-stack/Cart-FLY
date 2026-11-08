# Mailflux - freelancingaid.online Deployment & Live Setup Guide

আপনার নিজস্ব ডোমেন **`freelancingaid.online`** দিয়ে Cloudflare Email Routing, Cloudflare Worker (`mailflux-backend`), এবং Cloudflare KV (`MAIL_STORAGE`) সম্পূর্ণ লাইভ ও কনফিগার করা হয়েছে!

---

## 🚀 বর্তমান লাইভ স্ট্যাটাস (Live Architecture):

1. **ডোমেন**: `freelancingaid.online` (Cloudflare-এ একটিভ)
2. **Email Routing**: একটিভ (MX & SPF রেকর্ডস ক্লাউডফ্লেয়ার অটোমেটিক সেট করেছে)
3. **Catch-All Rule**: `*@freelancingaid.online` -> `mailflux-backend` Worker
4. **Cloudflare Worker**: `https://mailflux-backend.freelancing-aid.workers.dev`
5. **Storage**: Cloudflare Workers KV (`MAIL_STORAGE`, ID: `005d3816b99648a6822050f9bb2fe526`)
   - মেইলগুলো ২৪ ঘণ্টার জন্য সেভ থাকে (`expirationTtl: 86400`)। ২৪ ঘণ্টা পর অটোমেটিক ডিলিট হয়।
   - ক্লায়েন্ট সাইডে ইউজারের ব্রাউজারের `localStorage`-এ স্টোর থাকে।

---

## 💻 কীভাবে কাজ করে:

- **ইনকামিং ইমেইল**:
  যে কেউ যখন `anyone@freelancingaid.online` (যেমন: `tamim@freelancingaid.online`)-এ মেইল পাঠাবে:
  Cloudflare Email Routing সরাসরি `mailflux-backend` Worker-এ পাঠায়।
  Worker মেইলটি পার্স করে `MAIL_STORAGE` KV-তে সেভ করে।

- **একাউন্ট তৈরি ও লগইন**:
  ইউজারনেম এবং পাসওয়ার্ড দিয়ে লগইন করলে ক্লাউডফ্লেয়ার KV থেকে সেই ইউজারনেমের মেইল ইনবক্সে প্রদর্শিত হয়।

- **হোস্টিং প্ল্যাটফর্ম সাপোর্ট**:
  - **Local**: `npm start` -> `http://localhost:3000`
  - **Netlify**: `git push origin main` -> Netlify Functions সরাসরি ক্লাউডফ্লেয়ার এজ সার্ভিসে প্রক্সি করে।
  - **Cloudflare Pages**: `functions/api/[[catchall]].js` সরাসরি ক্লাউডফ্লেয়ার এজ সার্ভিসে প্রক্সি করে।
