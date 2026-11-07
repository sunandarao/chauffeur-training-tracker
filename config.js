// Paste the Web app URL from Apps Script (Deploy > Manage deployments) between the quotes.
window.APP_CONFIG = {
  APP_NAME: 'Chauffeured Car Rentals L&D Chauffeur Tracker',
  SUPPORT_EMAIL: 'sunanda.rao@ecosmobility.com', // 'Request access' on the sign-in page writes to this address
  // Target tab: these people see every L&D's target card (L&D users always see their own card).
  // Only an admin in this list can enter the monthly figures and edit locations.
  KRA_VIEWERS: ['sunanda.rao@ecosmobility.com', 'deepali.dev@ecosmobility.com', 'rini.ajeet@ecosmobility.com'],
  API_URL: 'https://script.google.com/macros/s/AKfycbwEmRJSKQ18dMj_Mp6E3AYLI7-DZqhSuXUT4J29FLJtskH7jl5aMoW4qb7I0KYoqxB2vA/exec'
};
