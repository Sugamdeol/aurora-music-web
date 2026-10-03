/* Standard Adcash interstitial. Autotag is intentionally removed. */
(() => {
  if (!window.aclib || typeof window.aclib.runInterstitial !== 'function') return;
  try { window.aclib.runInterstitial({ zoneId: '12261394' }); }
  catch (error) { console.warn('Adcash interstitial could not initialize:', error); }
})();
