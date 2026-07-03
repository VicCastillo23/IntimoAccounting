/**
 * Catálogo POS inicial (carta) — espejo fiel del seed de IntimoCoffeeApp
 * (DatabaseInitializer.kt + PricedModifierSeed.kt).
 *
 * Se usa una sola vez para poblar el servidor (fuente de verdad). A partir de
 * ahí la edición ocurre en la web de contabilidad y la tablet solo sincroniza.
 */

const UI = { DYNAMIC: "DYNAMIC", PRICED_MULTI: "PRICED_MULTI", TEMP_SINGLE: "TEMP_SINGLE" };

function buildCategories() {
  const cat = (id, name, color, sort, parentId = null) => ({
    id, name, color, description: null, icon: null, isActive: true, sortOrder: sort, parentId,
  });
  return [
    cat("p1", "Bebidas Calientes", "#6F4E37", 1),
    cat("p2", "Café Especialidad & Coldbrew", "#3D1C00", 2),
    cat("p3", "Fríos y Frappés", "#0D7377", 3),
    cat("p4", "Tisanas y Té", "#E91E63", 4),
    cat("p5", "Postres", "#FF69B4", 5),
    cat("p6", "Salados", "#FF5722", 6),
    cat("p7", "Extras", "#9E9E9E", 7),
    cat("1", "Extracciones Cortas", "#6F4E37", 1, "p1"),
    cat("2", "Con Café", "#8B4513", 2, "p1"),
    cat("3", "Lattes", "#D2691E", 3, "p1"),
    cat("4", "Café de Especialidad", "#3D1C00", 1, "p2"),
    cat("5", "Coldbrew", "#1C3A52", 2, "p2"),
    cat("6", "Bebidas con Coldbrew", "#2563A8", 3, "p2"),
    cat("7", "Fríos Especiales", "#0D7377", 1, "p3"),
    cat("8", "Frappés", "#32A8A8", 2, "p3"),
    cat("9", "Base Agua", "#1E88E5", 3, "p3"),
    cat("10", "Con Tapioca", "#7B1FA2", 4, "p3"),
    cat("11", "Tisanas Frutales", "#E91E63", 1, "p4"),
    cat("12", "Herbales", "#4CAF50", 2, "p4"),
    cat("13", "Té", "#009688", 3, "p4"),
    cat("14", "Postres", "#FF69B4", 1, "p5"),
    cat("15", "Salados", "#FF5722", 1, "p6"),
    cat("16", "Ensaladas", "#8BC34A", 2, "p6"),
    cat("17", "La Botanita", "#FF9800", 3, "p6"),
    cat("18", "Extras", "#9E9E9E", 1, "p7"),
  ];
}

function buildProducts() {
  const rows = [
    ["1", "Espresso", "50", "1"],
    ["2", "Espresso Doble", "56", "1"],
    ["3", "Espresso Macchiato", "56", "1"],
    ["4", "Espresso Cortado", "58", "1"],
    ["5", "E. Doble Cortado", "60", "1"],
    ["6", "Affogato", "69", "1"],
    ["7", "Americano", "55", "2", "Espresso+agua 250ml"],
    ["8", "Americano Long Black", "64", "2", "Agua+espresso doble 250ml"],
    ["9", "Americano Red Eye", "76", "2", "Extracción en prensa francesa+espresso doble 350ml"],
    ["10", "Vienés", "59", "2", "Americano+crema batida+cocoa"],
    ["11", "Flat White", "66", "2", "Leche acremada+espresso doble"],
    ["12", "Latte", "66", "2"],
    ["13", "Capuchino", "66", "2"],
    ["14", "Capuchino Sabor", "72", "2", "Avellana/Crema Irlandesa/Chocomenta/Coco Jengibre/Caramelo/CheeseCake/Vainilla"],
    ["15", "Capuchino Ron", "82", "2"],
    ["16", "Capuchino Rompope", "74", "2"],
    ["17", "Capuchino Baileys", "78", "2"],
    ["18", "Capuchino Hawaiano", "69", "2"],
    ["19", "Capuchino Amaretto", "79", "2"],
    ["20", "Moka", "74", "2"],
    ["21", "Moka Blanco", "74", "2"],
    ["22", "Chocolate Oaxaca", "72", "3"],
    ["23", "Chocolate Blanco", "72", "3"],
    ["24", "Algodón de Azúcar", "72", "3"],
    ["25", "Cookies", "72", "3"],
    ["26", "Chai", "72", "3", "Especiado/Banana/Manzana Verde/Free Sugar/Vainilla"],
    ["27", "Dirty Chai", "76", "3"],
    ["28", "Caramelo", "74", "3"],
    ["29", "Caramelo Espresso", "76", "3"],
    ["30", "Charcoal", "74", "3"],
    ["31", "Matcha", "80", "3"],
    ["32", "Taro", "74", "3"],
    ["33", "Chemex 1 Taza", "65", "4"],
    ["34", "Chemex 3 Tazas", "100", "4"],
    ["35", "Origami 1 Taza", "65", "4"],
    ["36", "Origami 3 Tazas", "100", "4"],
    ["37", "V60 1 Taza", "65", "4"],
    ["38", "V60 3 Tazas", "100", "4"],
    ["39", "Kalita 1 Taza", "65", "4"],
    ["40", "Kalita 2 Tazas", "100", "4"],
    ["41", "Aeropress", "65", "4"],
    ["42", "Sifón Japonés", "119", "4"],
    ["43", "Prensa Francesa", "65", "4"],
    ["44", "Moka Pot", "72", "4"],
    ["45", "Ibrik", "42", "4"],
    ["46", "Tótem 1 Taza", "65", "4"],
    ["47", "Tótem 3 Tazas", "100", "4"],
    ["48", "Torre Fría", "72", "5"],
    ["49", "Mizudashi", "65", "5"],
    ["50", "Coldbrew Latte", "80", "6", "Coldbrew+Leche"],
    ["51", "Coldbrew Latte Caramelo", "88", "6"],
    ["52", "Coldbrew Latte Vainilla", "88", "6"],
    ["53", "Coldbrew Rosemary", "89", "6", "Coldbrew+ginger ale+romero"],
    ["54", "Coldbrew Lichi", "89", "6", "Coldbrew+agua mineral+jarabe de lichi"],
    ["55", "Coldbrew Red", "89", "6", "Coldbrew+frutos rojos+agua tónica+agua mineral"],
    ["56", "Coldbrew Black", "85", "6", "Coldbrew+cocacola+crema de leche"],
    ["57", "Coldbrew Lime", "96", "6", "Coldbrew+jugo de naranja+refresco de lima"],
    ["58", "Coldbrew Flotante", "98", "6", "Coldbrew+cocacola+nieve de limón"],
    ["59", "Coldbrew Albahaca", "85", "6", "Coldbrew+infusión de albahaca+refresco de lima"],
    ["60", "Coldbrew Tropical", "98", "6", "Coldbrew+jarabe mango+pulpa de mango+ginger ale"],
    ["61", "Coldbrew Limonada", "79", "6"],
    ["62", "Coldbrew Naranjada", "79", "6"],
    ["63", "Espresso Shaker", "55", "7", "Espresso+mascabada"],
    ["64", "Espresso Tonic", "78", "7", "Espresso+agua tónica"],
    ["65", "Espresso Red Tonic", "85", "7", "Espresso+agua tónica+frutos rojos"],
    ["66", "Americano Frío", "69", "7"],
    ["67", "Aerocano", "72", "7", "Americano+vapor"],
    ["68", "Citrus Black", "84", "7", "Espresso+jugo de naranja"],
    ["69", "Black Mango", "89", "7", "Té negro+pulpa de mango+jugo de limón"],
    ["70", "Matcha Fruit", "89", "7", "Pulpa de maracuyá+agua mineral+matcha"],
    ["71", "Lichi Orange Soda", "86", "7", "Jarabe de lichi+agua mineral+jugo de naranja"],
    ["72", "Capuchino Frappé", "82", "8"],
    ["73", "Capuchino Sabor Frappé", "89", "8"],
    ["74", "Capuchino Baileys Frappé", "95", "8"],
    ["75", "Capuchino Rompope Frappé", "95", "8"],
    ["76", "Moka Frappé", "95", "8"],
    ["77", "Moka Blanco Frappé", "95", "8"],
    ["78", "Chocolate Oaxaca Frappé", "93", "8"],
    ["79", "Chocolate Blanco Frappé", "93", "8"],
    ["80", "Cookies Frappé", "93", "8"],
    ["81", "Caramelo Frappé", "95", "8"],
    ["82", "Espresso Caramelo Frappé", "98", "8"],
    ["83", "Íntimo", "98", "8"],
    ["84", "Algodón de Azúcar Frappé", "93", "8"],
    ["85", "Matcha Frappé", "99", "8"],
    ["86", "Taro Frappé (Perlas)", "99", "8"],
    ["87", "Chai Frappé", "93", "8", "Especiado/Choco Banana/Manzana Verde/Banana/Vainilla/Free Sugar"],
    ["88", "Yogurt & Frambuesa", "98", "8"],
    ["89", "Ice Latte", "76", "8"],
    ["90", "Ice Dirty Horchata", "94", "8", "Espresso+Horchata+Leche+canela"],
    ["91", "Blueberry", "86", "9"],
    ["92", "Frambuesa", "86", "9"],
    ["93", "Mango", "88", "9"],
    ["94", "Maracuyá", "86", "9"],
    ["95", "Frutos Rojos", "92", "9"],
    ["96", "Limonada", "55", "9"],
    ["97", "Limonada Pink", "79", "9", "Limonada+pulpa de frambuesa"],
    ["98", "Naranjada", "55", "9"],
    ["99", "Soda Italiana", "69", "9"],
    ["100", "Brown Sugar Tapioca Matcha", "115", "10"],
    ["101", "Brown Sugar Tapioca Coffee", "105", "10"],
    ["102", "Guayaba", "68", "11"],
    ["103", "Fresa Kiwi", "68", "11"],
    ["104", "Fresa Mango", "68", "11"],
    ["105", "Fresa Manzana", "68", "11"],
    ["106", "Lima Limón", "68", "11"],
    ["107", "Mango Coco", "68", "11"],
    ["108", "Manzana Arándano", "68", "11"],
    ["109", "Maracuyá", "68", "11"],
    ["110", "Plátano Cereza", "68", "11"],
    ["111", "Piña Canela", "68", "11"],
    ["112", "Manzanilla Lavanda", "68", "12"],
    ["113", "Menta", "68", "12"],
    ["114", "Relajante", "68", "12"],
    ["115", "Té Blanco", "68", "13"],
    ["116", "Té Verde", "68", "13"],
    ["117", "Té Rojo", "68", "13"],
    ["118", "Té Negro", "68", "13"],
    ["119", "Servicio 3 Tazas", "130", "13"],
    ["120", "Pastel de Chocolate", "68", "14"],
    ["121", "Pastel de Zanahoria", "68", "14"],
    ["122", "Red Velvet", "68", "14"],
    ["123", "Tiramisú", "79", "14"],
    ["124", "Brownie con Helado", "76", "14"],
    ["125", "Panqué de Elote con Helado", "68", "14"],
    ["126", "Muégano", "22", "14"],
    ["127", "Galletas de Chispas de Chocolate", "35", "14"],
    ["128", "Tarta de Chocolate Oscuro", "79", "14"],
    ["129", "Tarta de Chocolate Blanco y Uva", "79", "14"],
    ["130", "Tarta de Queso y Fresa", "68", "14"],
    ["131", "Tarta Tortuga", "68", "14"],
    ["132", "Pan Mini", "19", "14"],
    ["133", "Waffle", "68", "14"],
    ["134", "Bagel Tradicional", "99", "15", "Aderezo de perejil/jamón de pavo/jitomate/lechuga/queso gouda/papas chips"],
    ["135", "Bagel de Luxe", "102", "15", "Miel y mostaza/jamón de pavo/jamón serrano/espinaca/queso gouda/papas chips"],
    ["136", "Bagel de Quesos", "119", "15", "Aceite de oliva/queso cabra/queso gouda/queso provolone/uva/miel/espinaca"],
    ["137", "Chapata Italiana", "99", "15", "Aderezo de hierbas/jamón de pavo/jamón serrano/salami/lechuga/queso gouda"],
    ["138", "Chapata de Manzana", "99", "15", "Manzana/queso de cabra/nuez caramelizada/reducción de balsámico/espinaca"],
    ["139", "Baguette Mexicano", "102", "15", "Salsa macha/frijoles/jamón de pavo/jitomate/lechuga/queso gouda/chorizo"],
    ["140", "Baguette de la Casa", "99", "15", "Aderezo de hierbas/jamón de pavo/jamón serrano/jitomate cherry/lechuga/queso gouda"],
    ["141", "Baguette de Atún", "99", "15", "Atún en agua/mayonesa/espinaca/lechuga/aceituna negra/pepino/jitomate"],
    ["142", "Ensalada de la Casa", "98", "16", "Lechuga, espinaca, aderezo, crotones, jitomate cherry, boneless, queso gouda"],
    ["143", "Ensalada de Frutos Rojos", "98", "16", "Espinaca/lechuga/queso de cabra/nuez caramelizada/reducción de balsámico/fresa/frambuesa/blueberry/zarzamora"],
    ["144", "Boneless BBQ", "84", "17", "250gr"],
    ["145", "Boneless Búfalo", "84", "17", "250gr"],
    ["146", "Boneless Mango/Habanero", "84", "17", "250gr"],
    ["147", "Papas a la Francesa", "62", "17"],
    ["148", "Papas Gajo", "82", "17"],
    ["149", "Papas Chips", "39", "17", "Salsas negras+limón+chile en polvo"],
    ["150", "Nacho Mexicanos", "79", "17", "Frijoles+chorizo+pico de gallo"],
    ["151", "Extra de Café", "19", "18"],
    ["152", "Bombones", "12", "18"],
    ["153", "Crema Batida", "15", "18"],
    ["154", "Tapioca", "28", "18"],
    ["155", "Perla Explosiva", "25", "18"],
    ["156", "Leche Vegetal", "19", "18", "Coco/almendra/soya"],
    ["157", "Leche Oatly (Avena)", "20", "18"],
    ["158", "Refresco", "27", "18"],
    ["159", "Vaso de Leche", "25", "18"],
    ["160", "Botella de Agua", "17", "18"],
    ["161", "Jarabe Extra", "19", "18"],
    ["162", "Helado", "39", "18"],
  ];
  return rows.map((r, i) => ({
    id: r[0],
    name: r[1],
    price: r[2],
    categoryId: r[3],
    description: r[4] ?? null,
    isActive: true,
    stockQuantity: 100,
    minStockLevel: 5,
    taxRatePercent: "16",
    sortOrder: i,
  }));
}

function buildModifiers() {
  const out = [];
  const opt = (id, catId, name, priceExtra = "0", sort = 0, desc = null, uiGroup = UI.DYNAMIC, sectionTitle = null, sectionSortOrder = 0) =>
    out.push({ id, categoryId: catId, name, description: desc, priceExtra, sortOrder: sort, isActive: true, uiGroup, sectionTitle, sectionSortOrder });

  // Dinámicos: origen de café (cat 4,5,6) y tipo de leche (cat 7,8,9,10)
  const origenes4 = ["Oaxaca", "Kenia", "Marruecos", "Etiopía", "Chiapas", "Colombia", "Guatemala", "Brasil", "Perú", "Honduras"];
  origenes4.forEach((n, i) => opt(`m4_${i + 1}`, "4", n, "0", i + 1));
  ["Oaxaca", "Kenia", "Marruecos", "Etiopía", "Chiapas", "Colombia", "Guatemala", "Brasil"].forEach((n, i) => opt(`m5_${i + 1}`, "5", n, "0", i + 1));
  ["Oaxaca", "Kenia", "Marruecos", "Etiopía", "Chiapas", "Colombia"].forEach((n, i) => opt(`m6_${i + 1}`, "6", n, "0", i + 1));

  const leche = [["Leche Entera", "0"], ["Deslactosada", "0"], ["Leche Avena", "20"], ["Leche Coco", "20"]];
  for (const cid of ["7", "8", "9", "10"]) {
    leche.forEach(([n, p], i) => opt(`m${cid}_${i + 1}`, cid, n, p, i + 1, p !== "0" ? `+$${p}` : null));
  }

  // Priced multi / temperatura (PricedModifierSeed)
  const extracciones = [["Crema batida", "12"], ["Leche almendra", "17"], ["Leche coco", "17"], ["Leche soya", "17"], ["Leche avena", "20"], ["Deslactosada", "0"], ["Descafeinado", "0"], ["Bombones", "12"]];
  const cafeYLattes = [["Jarabe brown sugar", "9"], ["Extra café", "17"], ["Tapioca", "26"], ["Jarabe de avellana", "15"], ["Jarabe de crema irlandesa", "15"], ["Jarabe de chocolate", "15"], ["Jarabe de menta", "15"], ["Jarabe de coco", "15"], ["Jarabe de jengibre", "15"], ["Jarabe de vainilla", "15"], ["Jarabe de cheesecake", "15"], ["Jarabe de caramelo", "15"], ["Jarabe de calabaza", "15"], ["Extra rompope", "20"], ["Extra Bailey's", "20"], ["Extra RON", "39"], ["Perla explosiva", "19"], ["Jarabe natural extra", "15"]];
  const bebidasFrias = [["Sin hielo", "0"], ["Poco hielo", "0"], ["Sin jarabe", "0"], ["Poco jarabe", "0"], ["Para llevar", "0"], ["Vaso 16 oz", "17"], ["Sin panna", "0"], ["Dos platos", "0"], ["Frío", "0"], ["Frappé", "0"], ["Tibio", "0"]];
  const postres = [["Helado extra", "0"], ["Crema batida (postre)", "0"], ["Chocolate extra (postre)", "0"], ["Mermelada extra", "0"], ["Miel de maple extra", "0"]];
  const salados = [["A la mexicana", "22"], ["Chorizo", "26"], ["Diezmillo", "45"], ["Huevo", "20"], ["Jamón", "20"], ["Jamón serrano", "32"], ["Pollo", "34"], ["Salchicha", "22"], ["Tocino", "24"]];
  const salsas = [["Salsa BBQ", "0"], ["Salsa Búfalo", "0"], ["Salsa Mango Habanero", "0"]];
  const sin = [["NO queso", "0"], ["NO aguacate", "0"], ["NO cebolla", "0"], ["NO jitomate", "0"]];
  const temperaturaTisana = [["Caliente", "0"], ["Tibia", "0"], ["Filtrada", "0"], ["Con frutos", "0"]];

  const addSection = (cid, sectionTitle, sectionSortOrder, sectionKey, rows, uiGroup = UI.PRICED_MULTI) => {
    rows.forEach(([name, price], idx) => {
      opt(`pm_${cid}_${sectionKey}_${idx + 1}`, cid, name, price, idx, price !== "0" ? `+$${price}` : null, uiGroup, sectionTitle, sectionSortOrder);
    });
  };
  const addBebidasFrias = (cid) => {
    const idSuffixes = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "frappe", "10"];
    bebidasFrias.forEach(([name, price], idx) => {
      opt(`pm_${cid}_frias_${idSuffixes[idx]}`, cid, name, price, idx, price !== "0" ? `+$${price}` : null, UI.PRICED_MULTI, "Bebidas frías", 2);
    });
  };

  for (let c = 1; c <= 13; c++) {
    const cid = String(c);
    addSection(cid, "Extracciones cortas", 0, "extr", extracciones);
    addSection(cid, "Café y lattes", 1, "cafe", cafeYLattes);
    addBebidasFrias(cid);
  }
  addSection("14", "Postres", 0, "post", postres);
  for (let c = 15; c <= 17; c++) {
    const cid = String(c);
    addSection(cid, "Extras salados", 0, "sal", salados);
    addSection(cid, "Salsas", 1, "salsa", salsas);
    addSection(cid, "Sin", 2, "sin", sin);
  }
  for (let c = 11; c <= 13; c++) {
    addSection(String(c), "Temperatura", 3, "temp", temperaturaTisana, UI.TEMP_SINGLE);
  }
  return out;
}

export function buildCatalog() {
  return {
    categories: buildCategories(),
    products: buildProducts(),
    modifiers: buildModifiers(),
  };
}
