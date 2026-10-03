/* 1) Paste your Firebase web app settings here (Firebase console › Project settings › Your apps › Config). */
window.FIREBASE_CONFIG={
  apiKey:"PASTE_API_KEY",
  authDomain:"PASTE_PROJECT_ID.firebaseapp.com",
  projectId:"PASTE_PROJECT_ID",
  storageBucket:"PASTE_PROJECT_ID.appspot.com",
  messagingSenderId:"PASTE_SENDER_ID",
  appId:"PASTE_APP_ID"
};
/* 2) Your product and contact details (shown to shops). */
window.APP_NAME="Billing ERP";
window.TRIAL_DAYS=14;               /* keep in step with firestore.rules (15-day cap) */
window.SELLER={name:"",phone:"",email:""};  /* shown when a trial or plan ends, e.g. phone:"+91 98xxxxxx" */
