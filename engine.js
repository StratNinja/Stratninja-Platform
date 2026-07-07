/* StratNinja Journal — calculation engine
 * - Parses broker fill CSVs
 * - Computes closed round-trip trades via FIFO (handles longs, shorts, flips, scaling)
 * - Options (Clr Type 'Opti' or symbol ends with CALL/PUT) use a 100x multiplier
 * - Produces unified Trade objects consumed by the UI
 * No dependencies. Attaches to window.Engine.
 */
window.Engine = (function () {
  "use strict";

  const FEE_COLS = ["Commission", "SEC Fee", "TAF Fee", "ECN Fee", "Routing Fee", "NSCC Fee"];

  // ---- CSV parsing --------------------------------------------------------
  function parseCSVLine(line) {
    const out = [];
    let cur = "", inq = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inq) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; }
          else inq = false;
        } else cur += ch;
      } else {
        if (ch === '"') inq = true;
        else if (ch === ",") { out.push(cur); cur = ""; }
        else cur += ch;
      }
    }
    out.push(cur);
    return out.map(s => s.trim());
  }

  function toISO(mdy) {
    // MM/DD/YYYY -> YYYY-MM-DD
    const m = mdy.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return null;
    const mm = m[1].padStart(2, "0"), dd = m[2].padStart(2, "0");
    return `${m[3]}-${mm}-${dd}`;
  }

  function isOptionSymbol(sym, clrType) {
    if (clrType && clrType.toLowerCase().indexOf("opt") === 0) return true;
    return /(CALL|PUT)\s*$/i.test(sym);
  }

  /* Parse a broker CSV string into normalized fills.
   * Returns { fills: [...], account: "COLH..." | null, errors: [...] } */
  function parseCSV(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim().length);
    if (!lines.length) return { fills: [], account: null, errors: ["הקובץ ריק"] };
    const header = parseCSVLine(lines[0]);
    const idx = {};
    header.forEach((h, i) => { idx[h.trim()] = i; });
    const need = ["Trade Date", "Side", "Symbol", "Shares", "Price"];
    const missing = need.filter(n => !(n in idx));
    if (missing.length) {
      return { fills: [], account: null, errors: ["חסרות עמודות בקובץ: " + missing.join(", ")] };
    }
    const get = (row, name) => (idx[name] != null ? (row[idx[name]] || "").trim() : "");
    const fills = [];
    let account = null;
    const errors = [];
    for (let r = 1; r < lines.length; r++) {
      const row = parseCSVLine(lines[r]);
      const sym = get(row, "Symbol");
      if (!sym) continue;
      const iso = toISO(get(row, "Trade Date"));
      if (!iso) { errors.push("שורה " + (r + 1) + ": תאריך לא תקין"); continue; }
      const acct = get(row, "Account") || account || "";
      if (!account && acct) account = acct;
      const side = get(row, "Side").toUpperCase();
      const qty = parseFloat(get(row, "Shares")) || 0;
      const price = parseFloat(get(row, "Price")) || 0;
      let fees = 0;
      FEE_COLS.forEach(c => { fees += parseFloat(get(row, c)) || 0; });
      const clr = get(row, "Clr Type");
      const isOpt = isOptionSymbol(sym, clr);
      fills.push({
        account: acct,
        date: iso,
        side: side === "B" ? "B" : "S",
        symbol: sym,
        qty: qty,
        price: price,
        fees: fees,
        mult: isOpt ? 100 : 1,
        assetType: isOpt ? "option" : "stock",
        exec: get(row, "Exec Time"),
      });
    }
    return { fills, account, errors };
  }

  function fillKey(f) {
    return [f.account, f.date, f.exec, f.symbol, f.side, f.qty, f.price].join("|");
  }

  // ---- FIFO round-trip computation ---------------------------------------
  /* fills -> { trades: [...], openPositions: [...] } */
  function computeTrades(fills) {
    const sorted = fills.slice().sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return (a.exec || "") < (b.exec || "") ? -1 : 1;
    });

    const books = {};   // symbol -> { lots:[], ep:null }
    const trades = [];
    let tid = 1;

    function newEpisode(dir, f) {
      return {
        dir: dir, openQty: 0, entryNotional: 0,
        exitQty: 0, exitNotional: 0, fees: 0, realized: 0,
        entryDate: f.date, exitDate: f.date,
        mult: f.mult, assetType: f.assetType,
        symbol: f.symbol, account: f.account,
        fillKeys: [],  // keys of the raw fills that compose this episode (for safe deletion)
      };
    }
    function finalize(ep) {
      if (!ep || ep.openQty <= 0) return;
      trades.push({
        id: "t" + (tid++),
        source: "csv",
        account: ep.account,
        symbol: ep.symbol,
        assetType: ep.assetType,
        direction: ep.dir > 0 ? "long" : "short",
        qty: round(ep.openQty, 4),
        entryPrice: ep.openQty ? ep.entryNotional / ep.openQty : 0,
        exitPrice: ep.exitQty ? ep.exitNotional / ep.exitQty : 0,
        entryDate: ep.entryDate,
        exitDate: ep.exitDate,
        grossPnl: round(ep.realized, 2),
        fees: round(ep.fees, 2),
        pnl: round(ep.realized - ep.fees, 2),
        notes: "", tags: [],
        fillKeys: ep.fillKeys.slice(),
      });
    }

    for (const f of sorted) {
      const b = books[f.symbol] || (books[f.symbol] = { lots: [], ep: null });
      const signed = (f.side === "B" ? 1 : -1) * f.qty;
      let rem = signed;
      let closedQty = 0;
      // close against opposite-sign lots (FIFO)
      while (rem !== 0 && b.lots.length && (b.lots[0].q > 0) !== (rem > 0)) {
        const lot = b.lots[0];
        const match = Math.min(Math.abs(lot.q), Math.abs(rem));
        const realizedPart = lot.q > 0
          ? (f.price - lot.p) * match * lot.mult
          : (lot.p - f.price) * match * lot.mult;
        if (!b.ep) b.ep = newEpisode(lot.q > 0 ? 1 : -1, f); // safety
        b.ep.realized += realizedPart;
        b.ep.exitQty += match;
        b.ep.exitNotional += f.price * match;
        b.ep.exitDate = f.date;
        lot.q -= lot.q > 0 ? match : -match;
        rem -= rem < 0 ? -match : match;
        closedQty += match;
        if (lot.q === 0) b.lots.shift();
      }
      // this fill's fees belong to the episode it acted on (closing side on a flip)
      const fk = fillKey(f);
      if (b.ep) { b.ep.fees += f.fees; b.ep.fillKeys.push(fk); }

      // position went flat (all lots consumed after a close) -> close the trade.
      // covers both a clean close (rem === 0) and a flip through zero (rem !== 0).
      if (b.ep && closedQty > 0 && b.lots.length === 0) {
        finalize(b.ep);
        b.ep = null;
      }

      // opening / extending a position with any remainder
      if (rem !== 0) {
        // pure open (closedQty === 0): fees belong here. On a flip they were
        // already added to the just-finalized closing episode above.
        if (!b.ep) { b.ep = newEpisode(rem > 0 ? 1 : -1, f); if (closedQty === 0) b.ep.fees += f.fees; b.ep.fillKeys.push(fk); }
        b.ep.openQty += Math.abs(rem);
        b.ep.entryNotional += f.price * Math.abs(rem);
        b.lots.push({ q: rem, p: f.price, mult: f.mult });
      }
    }

    // leftover open positions
    const openPositions = [];
    Object.keys(books).forEach(sym => {
      const b = books[sym];
      const net = b.lots.reduce((s, l) => s + l.q, 0);
      if (Math.abs(net) > 1e-9 && b.ep) {
        openPositions.push({
          symbol: sym, account: b.ep.account, qty: round(net, 4),
          direction: net > 0 ? "long" : "short",
          avgPrice: b.ep.openQty ? b.ep.entryNotional / b.ep.openQty : 0,
          assetType: b.ep.assetType, entryDate: b.ep.entryDate,
        });
      }
    });

    return { trades, openPositions };
  }

  // ---- Manual trade -> unified Trade -------------------------------------
  function manualToTrade(m) {
    const mult = m.assetType === "option" ? 100 : 1;
    const qty = Math.abs(parseFloat(m.qty) || 0);
    const entry = parseFloat(m.entryPrice) || 0;
    // No exit price entered => the position is still OPEN (unrealized).
    const hasExit = m.exitPrice !== "" && m.exitPrice != null && !isNaN(parseFloat(m.exitPrice));
    const exit = hasExit ? parseFloat(m.exitPrice) : 0;
    const fees = Math.abs(parseFloat(m.fees) || 0);
    const gross = hasExit ? (m.direction === "short" ? (entry - exit) : (exit - entry)) * qty * mult : 0;
    return {
      id: m.id || ("m" + Date.now() + Math.floor(Math.random() * 1000)),
      source: "manual",
      open: !hasExit,
      account: m.account,
      symbol: (m.symbol || "").toUpperCase().trim(),
      assetType: m.assetType || "stock",
      direction: m.direction || "long",
      qty: qty,
      mult: mult,
      entryPrice: entry,
      exitPrice: hasExit ? exit : null,
      entryDate: m.entryDate,
      exitDate: hasExit ? (m.exitDate || m.entryDate) : null,
      grossPnl: hasExit ? round(gross, 2) : 0,
      fees: round(fees, 2),
      pnl: hasExit ? round(gross - fees, 2) : 0,
      notes: m.notes || "",
      tags: m.tags || [],
      img: m.img || null,
    };
  }

  // ---- Aggregations / stats ----------------------------------------------
  function dailyFromTrades(trades) {
    // key = exitDate (day P&L was realized)
    const days = {};
    trades.forEach(t => {
      const k = t.exitDate;
      const d = days[k] || (days[k] = { net: 0, trades: 0, wins: 0, losses: 0, symbols: {} });
      d.net += t.pnl;
      d.trades += 1;
      if (t.pnl > 0) d.wins += 1; else if (t.pnl < 0) d.losses += 1;
      d.symbols[t.symbol] = (d.symbols[t.symbol] || 0) + t.pnl;
    });
    Object.keys(days).forEach(k => {
      const d = days[k];
      d.net = round(d.net, 2);
      d.win = d.trades ? round(100 * d.wins / d.trades, 1) : null;
    });
    return days;
  }

  function stats(trades) {
    const n = trades.length;
    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl < 0);
    const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
    const net = trades.reduce((s, t) => s + t.pnl, 0);
    const fees = trades.reduce((s, t) => s + t.fees, 0);
    return {
      count: n,
      net: round(net, 2),
      fees: round(fees, 2),
      winRate: n ? round(100 * wins.length / n, 1) : 0,
      wins: wins.length,
      losses: losses.length,
      avgWin: wins.length ? round(grossWin / wins.length, 2) : 0,
      avgLoss: losses.length ? round(grossLoss / losses.length, 2) : 0,
      profitFactor: grossLoss ? round(grossWin / grossLoss, 2) : (grossWin ? Infinity : 0),
      bestTrade: n ? round(Math.max.apply(null, trades.map(t => t.pnl)), 2) : 0,
      worstTrade: n ? round(Math.min.apply(null, trades.map(t => t.pnl)), 2) : 0,
    };
  }

  function equityCurve(trades) {
    const sorted = trades.slice().sort((a, b) =>
      a.exitDate < b.exitDate ? -1 : (a.exitDate > b.exitDate ? 1 : 0));
    let cum = 0;
    const byDay = {};
    sorted.forEach(t => { byDay[t.exitDate] = (byDay[t.exitDate] || 0) + t.pnl; });
    const days = Object.keys(byDay).sort();
    return days.map(d => { cum += byDay[d]; return { date: d, equity: round(cum, 2), day: round(byDay[d], 2) }; });
  }

  function round(v, n) { const p = Math.pow(10, n || 0); return Math.round(v * p) / p; }

  return {
    parseCSV, computeTrades, manualToTrade, fillKey,
    dailyFromTrades, stats, equityCurve, isOptionSymbol,
  };
})();
