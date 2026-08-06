/**
 * Nilus ECA - Carbon Calculator & Water Stress Factor Service
 * ÊÕœ… Õ”«» ⁄“· «·ﬂ—»Ê‰ Ê„⁄«„· «·≈ÃÂ«œ «·„«∆Ì (WSF) ·‹ 25 „Õ’Ê·« “—«⁄Ì«
 */

// 1. ﬁ«⁄œ… »Ì«‰«  «·‹ 25 „Õ’Ê·« Ê«·„⁄«„·«  «·√”«”Ì…
const CROPS_CARBON_DATABASE = {
  // «·Õ»Ê» «·≈” —« ÌÃÌ…
  "wheat": { name: "ﬁ„Õ", baseAbsorptionRate: 2.8, wsfSensitivity: 1.2, biomassFactor: 0.45 },
  "maize": { name: "–—… ’›—«¡", baseAbsorptionRate: 3.5, wsfSensitivity: 1.3, biomassFactor: 0.50 },
  "rice": { name: "√—“", baseAbsorptionRate: 3.2, wsfSensitivity: 1.4, biomassFactor: 0.42 },
  "barley": { name: "‘⁄Ì—", baseAbsorptionRate: 2.4, wsfSensitivity: 1.1, biomassFactor: 0.43 },
  "sorghum": { name: "–—… —›Ì⁄…", baseAbsorptionRate: 3.0, wsfSensitivity: 1.2, biomassFactor: 0.47 },

  // «·„Õ«’Ì· «·“Ì Ì… Ê«·√·Ì«›
  "cotton": { name: "ﬁÿ‰", baseAbsorptionRate: 2.6, wsfSensitivity: 1.3, biomassFactor: 0.40 },
  "soybean": { name: "›Ê· ’ÊÌ«", baseAbsorptionRate: 2.5, wsfSensitivity: 1.2, biomassFactor: 0.45 },
  "sunflower": { name: "⁄»«œ «·‘„”", baseAbsorptionRate: 2.7, wsfSensitivity: 1.25, biomassFactor: 0.44 },
  "sesame": { name: "”„”„", baseAbsorptionRate: 2.1, wsfSensitivity: 1.1, biomassFactor: 0.38 },
  "peanut": { name: "›Ê· ”Êœ«‰Ì", baseAbsorptionRate: 2.3, wsfSensitivity: 1.15, biomassFactor: 0.40 },

  // «·Œ÷—Ê« 
  "tomato": { name: "ÿ„«ÿ„", baseAbsorptionRate: 3.1, wsfSensitivity: 1.35, biomassFactor: 0.35 },
  "potato": { name: "»ÿ«ÿ”", baseAbsorptionRate: 2.9, wsfSensitivity: 1.2, biomassFactor: 0.38 },
  "onion": { name: "»’·", baseAbsorptionRate: 2.2, wsfSensitivity: 1.1, biomassFactor: 0.33 },
  "garlic": { name: "ÀÊ„", baseAbsorptionRate: 2.0, wsfSensitivity: 1.05, biomassFactor: 0.32 },
  "cabbage": { name: "ﬂ—‰»", baseAbsorptionRate: 2.5, wsfSensitivity: 1.2, biomassFactor: 0.30 },
  "eggplant": { name: "»«–‰Ã«‰", baseAbsorptionRate: 2.8, wsfSensitivity: 1.25, biomassFactor: 0.36 },
  "cucumber": { name: "ŒÌ«—", baseAbsorptionRate: 2.7, wsfSensitivity: 1.3, biomassFactor: 0.34 },
  "pepper": { name: "›·›·", baseAbsorptionRate: 2.6, wsfSensitivity: 1.25, biomassFactor: 0.35 },

  // «·√‘Ã«— «·„À„—… ( ⁄ „œ ⁄·Ï «·ﬂ ·… «·ÕÌÊÌ… «·œ«∆„…)
  "citrus": { name: "„Ê«œ Õ„÷Ì… (»— ﬁ«·/ÌÊ”›Ì)", baseAbsorptionRate: 4.5, wsfSensitivity: 1.4, biomassFactor: 0.55 },
  "date_palm": { name: "‰ŒÌ· «· „—", baseAbsorptionRate: 5.0, wsfSensitivity: 1.5, biomassFactor: 0.60 },
  "olive": { name: "“Ì Ê‰", baseAbsorptionRate: 4.2, wsfSensitivity: 1.3, biomassFactor: 0.52 },
  "mango": { name: "„«‰ÃÊ", baseAbsorptionRate: 4.8, wsfSensitivity: 1.45, biomassFactor: 0.58 },
  "grape": { name: "⁄‰»", baseAbsorptionRate: 3.8, wsfSensitivity: 1.35, biomassFactor: 0.48 },
  "pomegranate": { name: "—„«‰", baseAbsorptionRate: 3.6, wsfSensitivity: 1.3, biomassFactor: 0.46 },
  "banana": { name: "„Ê“", baseAbsorptionRate: 5.2, wsfSensitivity: 1.6, biomassFactor: 0.50 }
};

/**
 * 2. œ«·… Õ”«» ⁄«„· «·≈ÃÂ«œ «·„«∆Ì (WSF) Ê≈Ã„«·Ì ⁄“· «·ﬂ—»Ê‰ (tCO2e)
 * @param {string} cropKey - „› «Õ «·„Õ’Ê· „‰ «·ﬁ«∆„… √⁄·«Â
 * @param {number} meanNdvi - „ Ê”ÿ ﬁÌ„… NDVI «·„” Œ—Ã… „‰ «·√ﬁ„«— «·’‰«⁄Ì… (Sentinel-2)
 * @param {number} meanNdwi - „ Ê”ÿ ﬁÌ„… NDWI („ƒ‘— «·„Ì«Â) · ÕœÌœ Õ«·… «·≈ÃÂ«œ «·—ÿÊ»Ì
 * @param {number} areaHectares - „”«Õ… «·ÕÌ«“… «·“—«⁄Ì… »«·Âﬂ «—
 * @returns {Object} ‰ «∆Ã «·Õ”«»«  «· ›’Ì·Ì…
 */
function calculateCropCarbon(cropKey, meanNdvi, meanNdwi, areaHectares) {
  const crop = CROPS_CARBON_DATABASE[cropKey];
  if (!crop) {
    throw new Error(`«·„Õ’Ê· «·„ÿ·Ê» €Ì— „ Ê›— ›Ì ﬁ«⁄œ… «·»Ì«‰« : ${cropKey}`);
  }

  // Õ”«» „⁄«„· «·≈ÃÂ«œ «·„«∆Ì (WSF) »‰«¡ ⁄·Ï „ƒ‘— «·„Ì«Â Ê«·€ÿ«¡ «·Œ÷—Ì
  let wsf = 1.0 - Math.max(0, (0.4 - meanNdwi)) * crop.wsfSensitivity;
  
  // ÷»ÿ «·ÕœÊœ ·ÌﬂÊ‰ «·„⁄«„· ÷„‰ ‰ÿ«ﬁ „‰ÿﬁÌ Ê„ﬁ»Ê· (»Ì‰ 0.4 Ê 1.1)
  wsf = Math.min(Math.max(wsf, 0.4), 1.1);

  // Õ”«» „⁄œ· «·«„ ’«’ «·›⁄·Ì »«·ÿ‰ ·ﬂ· Âﬂ «— „⁄ „—«⁄«… ‰‘«ÿ «·ﬂ ·… «·ÕÌÊÌ… (NDVI) Ê„⁄«„· «·≈ÃÂ«œ
  const effectiveAbsorptionRate = crop.baseAbsorptionRate * Math.max(0.1, meanNdvi) * wsf;

  // Õ”«» ≈Ã„«·Ì ÿ‰ „ﬂ«‰Ì À«‰Ì √ﬂ”Ìœ «·ﬂ—»Ê‰ «·„„ ’ (tCO2e)
  const totalTCO2e = effectiveAbsorptionRate * areaHectares * crop.biomassFactor;

  return {
    cropKey,
    cropName: crop.name,
    areaHectares,
    meanNdvi: parseFloat(meanNdvi.toFixed(4)),
    meanNdwi: parseFloat(meanNdwi.toFixed(4)),
    waterStressFactor: parseFloat(wsf.toFixed(3)),
    effectiveAbsorptionRatePerHectare: parseFloat(effectiveAbsorptionRate.toFixed(3)),
    totalTCO2e: parseFloat(totalTCO2e.toFixed(4))
  };
}

module.exports = {
  CROPS_CARBON_DATABASE,
  calculateCropCarbon
};