# Mailflux - Netlify & Cloudflare Deployment Guide
(নেটলিফাই এবং ক্লাউডফ্লেয়ার হোস্টিং গাইড)

এই প্রজেক্টটি এখন **Netlify** এবং **Cloudflare** উভয় প্ল্যাটফর্মে ফুল-স্ট্যাক (Frontend + Serverless API) রান করার জন্য সম্পূর্ণ প্রস্তুত করা হয়েছে।

---

## 📁 স্ট্রাকচার ওভারভিউ (What was prepared)

1. **`netlify.toml`**: Netlify-এর বিল্ড, রিডাইরেক্ট (`/api/*` -> Netlify Functions), সিকিউরিটি হেডার এবং ক্যাশিং প্রিভেনশন কনফিগারেশন।
2. **`netlify/functions/api.js`**: `serverless-http` দিয়ে Express API হ্যান্ডলার যা Netlify Functions-এ সার্ভারলেস হিসেবে রান করে।
3. **`functions/api/[[catchall]].js`**: Cloudflare Pages Functions-এর জন্য নেটিভ Edge Runtime API হ্যান্ডলার (V8 Edge Workers)।
4. **`public/_redirects` & `public/_headers`**: Netlify ও Cloudflare Pages-এর জন্য ক্যাশ ও রিডাইরেক্ট কন্ট্রোল।
5. **`wrangler.toml`**: Cloudflare CLI / Pages ডেপ্লয়মেন্ট কনফিগারেশন।
6. **`server.js`**: রিফ্যাক্টর করা হয়েছে যাতে লোকালি (`npm start`) এবং সার্ভারলেস ক্লাউডে একই সাথে কাজ করে।

---

## অপশন ১: Netlify-তে হোস্ট করার নিয়ম (Deploy to Netlify)

### মেথড A: GitHub এর মাধ্যমে (সবচেয়ে সহজ)
1. কোডগুলো আপনার GitHub রিপোজিটরিতে পুশ করুন:
   ```bash
   git add .
   git commit -m "Ready for Netlify and Cloudflare"
   git push origin main
   ```
2. [Netlify Dashboard](https://app.netlify.com)-এ যান।
3. **"Add new site"** > **"Import an existing project"** > **"GitHub"** সিলেক্ট করুন।
4. আপনার রিপোজিটরি সিলেক্ট করুন।
5. সেটিংস অটোমেটিক লোড হবে (`netlify.toml` থেকে):
   - **Base directory**: খালি রাখুন
   - **Build command**: খালি রাখুন
   - **Publish directory**: `public`
   - **Functions directory**: `netlify/functions`
6. **Deploy** বাটনে ক্লিক করুন। ২ মিনিটের মধ্যে সাইট লাইভ হয়ে যাবে!

### মেথড B: Netlify CLI দিয়ে সরাসরি ডেপ্লয়
```bash
# Netlify CLI ইনস্টল (যদি না থাকে)
npm install -g netlify-cli

# লগইন এবং সরাসরি প্রোডাকশন ডেপ্লয়
netlify login
netlify deploy --prod
```

---

## অপশন ২: Cloudflare Pages-এ সরাসরি হোস্ট করার নিয়ম (Deploy to Cloudflare Pages)

Cloudflare Pages-এ সম্পূর্ণ বিনামূল্যে গ্লোবাল এজ নেটওয়ার্কে হোস্ট করা যায় (নো কোল্ড স্টার্ট)।

### মেথড A: Cloudflare ড্যাশবোর্ড থেকে
1. আপনার কোড GitHub-এ পুশ করুন।
2. [Cloudflare Dashboard](https://dash.cloudflare.com) > **Workers & Pages** > **Create application** > **Pages** > **Connect to Git**-এ যান।
3. রিপোজিটরি সিলেক্ট করুন।
4. বিল্ড সেটিংস দিন:
   - **Framework preset**: `None`
   - **Build command**: খালি রাখুন
   - **Build output directory**: `public`
5. **Save and Deploy** দিন। `functions/api/[[catchall]].js` স্বয়ংক্রিয়ভাবে ক্লাউডফ্লেয়ার এজ ফাংশন হিসেবে একটিভ হয়ে যাবে!

### মেথড B: Wrangler CLI দিয়ে
```bash
npx wrangler pages deploy public
```

---

## অপশন ৩: Netlify হোস্টিং + Cloudflare ডোমেন/CDN (সবচেয়ে জনপ্রিয় কম্বিনেশন)

যদি আপনি সাইটটি **Netlify**-তে হোস্ট করেন এবং আপনার ডোমেন **Cloudflare**-এর মাধ্যমে কানেক্ট করেন, তাহলে নিচের ৩টি সেটিংস অবশ্যই নিশ্চিত করুন:

### ১. Cloudflare DNS CNAME রেকর্ড:
- Type: `CNAME`
- Name: `@` অথবা `mail` (বা আপনার সাবডোমেন)
- Target: `your-site-name.netlify.app`
- Proxy status: **Proxied** (কমলা মেঘ / Orange cloud)

### ২. Cloudflare SSL/TLS মোড (গুরুত্বপূর্ণ):
- Cloudflare ড্যাশবোর্ডে **SSL/TLS** মেনুতে যান।
- Encryption mode অবশ্যই **Full** অথবা **Full (strict)** সিলেক্ট করুন।
- ⚠️ *সতর্কতা: "Flexible" সিলেক্ট করলে `ERR_TOO_MANY_REDIRECTS` এরর আসবে।*

### ৩. API ক্যাশ বাইপাস (Cache Rule):
যেহেতু এটি একটি টেম্প মেইল সার্ভিস, তাই ইমেইল আসার রিকোয়েস্টগুলো ক্লাউডফ্লেয়ার যেন ক্যাশ না করে তার জন্য:
1. Cloudflare ড্যাশবোর্ডে **Caching** > **Cache Rules** > **Create Rule**-এ যান।
2. রুল নাম দিন: `Bypass API Cache`
3. ফিল্ড সেট করুন:
   - When incoming requests match: **URI Path**
   - Operator: **starts with**
   - Value: `/api/`
4. Cache eligibility: **Bypass cache**
5. **Deploy** বাটনে ক্লিক করুন।

---

## 💻 লোকাল ডেভেলপমেন্ট (Local Run)
লোকাল মেশিনে আগের মতোই রান করতে পারেন:
```bash
npm start
# অথবা
node server.js
```
ব্রাউজারে ওপেন করুন: `http://localhost:3000`
