/* ============================================================
   World Cup 2026 — shared data
   Update fixtures & prices here; both site styles read from it.
   status: "available" | "limited" | "unk" (not yet on sale)
   price : number (USD floor) | null
   stage : "group" | "knockout"
   ============================================================ */
window.WC = {
  meta: {
    totalMatches: 104,
    hostCities: 16,
    sims: 20000,
  },

  fixtures: [
    { id:"mex-rsa", date:"2026-06-11", time:"19:00", a:{n:"Mexico",f:"🇲🇽"},        b:{n:"South Africa",f:"🇿🇦"},          group:"A", stage:"group", venue:"Estadio Azteca",   city:"Mexico City",  status:"available", price:165 },
    { id:"kor-cze", date:"2026-06-12", time:"02:00", a:{n:"Korea Republic",f:"🇰🇷"}, b:{n:"Czechia",f:"🇨🇿"},               group:"A", stage:"group", venue:"Estadio Akron",    city:"Guadalajara",  status:"unk",       price:null },
    { id:"can-bih", date:"2026-06-12", time:"19:00", a:{n:"Canada",f:"🇨🇦"},        b:{n:"Bosnia & Herzegovina",f:"🇧🇦"},  group:"B", stage:"group", venue:"BMO Field",        city:"Toronto",      status:"unk",       price:null },
    { id:"usa-par", date:"2026-06-13", time:"01:00", a:{n:"United States",f:"🇺🇸"}, b:{n:"Paraguay",f:"🇵🇾"},              group:"D", stage:"group", venue:"SoFi Stadium",     city:"Los Angeles",  status:"limited",   price:290 },
    { id:"mar-jpn", date:"2026-06-13", time:"19:00", a:{n:"Morocco",f:"🇲🇦"},       b:{n:"Japan",f:"🇯🇵"},                 group:"F", stage:"group", venue:"Hard Rock Stadium",city:"Miami",        status:"available", price:145 },
    { id:"aus-tur", date:"2026-06-13", time:"04:00", a:{n:"Australia",f:"🇦🇺"},     b:{n:"Türkiye",f:"🇹🇷"},               group:"D", stage:"group", venue:"BC Place",         city:"Vancouver",    status:"unk",       price:null },
  ],

  /* round-by-round survival %, from 20,000 sims
     c = [WinGrp, Advance, R16, QF, SF, Final, Champion] */
  projections: [
    { fl:"🇦🇷", nm:"Argentina",   g:"J", e:2085, c:[98,100,99,97,84,58,34] },
    { fl:"🇫🇷", nm:"France",      g:"I", e:2070, c:[96,100,99,96,77,44,24] },
    { fl:"🇪🇸", nm:"Spain",       g:"H", e:2065, c:[87,100,99,95,71,39,21] },
    { fl:"🇧🇷", nm:"Brazil",      g:"C", e:2030, c:[87,100,98,89,55,23,10] },
    { fl:"🏴",  nm:"England",     g:"L", e:2005, c:[78,100,98,83,40,14,6]  },
    { fl:"🇵🇹", nm:"Portugal",    g:"K", e:1990, c:[78,100,97,77,25,9,3]   },
    { fl:"🇳🇱", nm:"Netherlands", g:"F", e:1968, c:[84,100,96,69,18,6,2]   },
    { fl:"🇩🇪", nm:"Germany",     g:"E", e:1938, c:[86,100,92,54,9,3,0.5]  },
    { fl:"🇧🇪", nm:"Belgium",     g:"G", e:1920, c:[88,100,88,44,6,2,0.5]  },
    { fl:"🇺🇾", nm:"Uruguay",     g:"H", e:1900, c:[13,99,83,29,4,0.5,0.5] },
    { fl:"🇭🇷", nm:"Croatia",     g:"L", e:1893, c:[22,99,79,22,3,0.5,0.5] },
  ],

  // column labels for projections (index-aligned with c[])
  projCols: ["Win Grp","Advance","R16","QF","SF","Final","Champion"],
};

/* ---- shared formatting / date helpers ---- */
window.WCfmt = {
  pct: v => v < 1 ? "<1%" : v + "%",
  // "2026-06-13" -> {dd:"13", wd:"Saturday", mo:"June", moShort:"Jun"}
  day(iso){
    const d = new Date(iso + "T12:00:00");
    return {
      dd: String(d.getDate()),
      wd: d.toLocaleDateString("en-US",{weekday:"long"}),
      wdShort: d.toLocaleDateString("en-US",{weekday:"short"}),
      mo: d.toLocaleDateString("en-US",{month:"long"}),
      moShort: d.toLocaleDateString("en-US",{month:"short"}),
      key: iso,
    };
  },
  // "19:00" -> {h:"7:00", ap:"pm"}
  time(t){
    let [h,m] = t.split(":").map(Number);
    const ap = h >= 12 ? "pm" : "am";
    h = h % 12; if (h === 0) h = 12;
    return { h: h + ":" + String(m).padStart(2,"0"), ap };
  },
};
