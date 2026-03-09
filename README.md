# 🏎️ Fanta F1 2026

App web per giocare al Fanta F1 tra colleghi, con pronostici, pagamenti PayPal e classifica automatica.

## 🎮 Come funziona

### Per i partecipanti:
1. Si registrano.
2. Prima di ogni GP: cliccano sulla gara, pagano 1€ tramite PayPal
3. Ordinano i piloti in ordine di arrivo previsto (drag & drop)
4. Selezionano chi faranno DNF e chi prenderà la pole
5. Salvano entro la deadline (venerdì sera)

### Per l'admin:
1. Dopo la gara (domenica sera/lunedì): vai in **Admin → Gare**
2. Clicca **"Risultati API"** sulla gara appena conclusa
3. Il sistema recupera i risultati da Jolpica F1 API
4. I punteggi vengono calcolati automaticamente per tutti
5. Se un pilota ha causato incidente: modifica il flag manualmente

### Pagine disponibili:
- `/` → Login/Registrazione
- `/dashboard.html` → Dashboard utente (pronostici, classifica, storico)
- `/leaderboard.html` → Classifica pubblica (senza login)
- `/admin.html` → Pannello admin

---

## 📊 Regole punteggio implementate

**Base:** 200 punti per gara

**Punti posizione:**
- `-1` per ogni posizione di discostamento
- `+10` per ogni posizione corretta
- `+5` per ogni DNF corretto

**Bonus:**
- `+20` indovinare posizione piloti stessa scuderia (cumulabile)
- `+20` indovinare ultima posizione (non DNF)
- `+10` pole position corretta
- `+30` azzecca podio (top 3)
- `+50` azzecca podio Ferrari

**Malus:**
- `-10` azzecca 1° ma sbaglia tutti gli altri
- `-20` sbaglia tutte le posizioni
- `-20` pilota podio DNF (cumulabile)
- `-10` DNF provoca incidente
- `-30` pole position DNF


## 🆘 Problemi comuni

**PayPal non funziona:**
- In modalità sandbox usa account di test PayPal developer
- Assicurati che `BASE_URL` punti al tuo dominio reale con HTTPS

**Calendario non si sincronizza:**
- Jolpica API potrebbe non avere ancora i dati 2026 completi a inizio stagione
- In alternativa puoi inserire le gare manualmente dal pannello admin

**Piloti mancanti:**
- Fai "Sincronizza Piloti" dopo il "Sincronizza Calendario"
- Se un pilota è nuovo e non compare, l'API potrebbe non averlo ancora
