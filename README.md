# 🏎️ Fanta F1 2026

App web per giocare al Fanta F1 tra colleghi, con pronostici, pagamenti PayPal e classifica automatica.

---

## 🚀 Setup rapido (Docker sul NAS)

### 1. Copia il progetto sul NAS
```bash
# Dal tuo PC, copia la cartella sul NAS via SSH o File Station
scp -r fanta-f1/ max@192.168.1.xxx:/volume1/docker/fanta-f1
```

### 2. Configura le variabili d'ambiente
```bash
cd /volume1/docker/fanta-f1
cp .env.example .env
nano .env   # oppure vi .env
```

Compila il file `.env`:
```
SESSION_SECRET=una_stringa_random_lunga_almeno_32_caratteri
ADMIN_USERNAME=admin
ADMIN_PASSWORD=la_tua_password_admin
PAYPAL_CLIENT_ID=il_tuo_client_id_paypal
PAYPAL_CLIENT_SECRET=il_tuo_client_secret_paypal
PAYPAL_MODE=sandbox       # cambia in "live" quando sei pronto
BASE_URL=https://fantaf1.tuodominio.it
```

### 3. Ottieni credenziali PayPal
1. Vai su https://developer.paypal.com
2. Crea un'app in "My Apps & Credentials"
3. Copia Client ID e Secret in modalità **Sandbox** per i test
4. Quando sei pronto per il reale, usa le credenziali **Live**

### 4. Sostituisci il Client ID PayPal nell'HTML
Nel file `public/dashboard.html`, cerca la riga:
```html
<script src="https://www.paypal.com/sdk/js?client-id=__PAYPAL_CLIENT_ID__&currency=EUR">
```
E sostituisci `__PAYPAL_CLIENT_ID__` con il tuo Client ID PayPal reale.

### 5. Avvia il container
```bash
docker-compose up -d
docker-compose logs -f   # controlla i log
```

### 6. Crea l'utente admin
```bash
docker exec fanta-f1 node setup-admin.js admin tua@email.it TuaPassword123
```

### 7. Prima configurazione (da pannello admin)
1. Vai su `http://localhost:3000` e accedi come admin
2. Vai in **Admin → Sincronizzazione**
3. Clicca **"Sincronizza Calendario"** → importa tutte le gare 2026
4. Clicca **"Sincronizza Piloti"** → importa la griglia 2026
5. Clicca **"Importa Storico 2025"** → importa i risultati dell'anno scorso (ci vuole ~2 minuti)
6. Vai in **Admin → Gare** e imposta le deadline corrette

---

## 📡 Esposizione su internet (con DDNS Synology)

Se hai già un DDNS su Synology:

1. **Synology DSM → Pannello di controllo → Accesso esterno → DDNS**: attiva e configura
2. **Application Portal → Proxy inverso**: aggiungi una regola
   - Origine: `https` / `fantaf1.tuodominio.it` / porta 443
   - Destinazione: `http` / `localhost` / porta 3000
3. Attiva il certificato Let's Encrypt dal gestore certificati

---

## 🎮 Come funziona

### Per i partecipanti:
1. Si registrano su `http://tuodominio.it`
2. Prima di ogni GP: cliccano sulla gara, pagano 1€ tramite PayPal
3. Ordinano i piloti in ordine di arrivo previsto (drag & drop)
4. Selezionano chi faranno DNF e chi prenderà la pole
5. Salvano entro la deadline (venerdì sera)

### Per l'admin (tu):
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

---

## 🔧 Comandi utili

```bash
# Vedi log live
docker-compose logs -f fanta-f1

# Riavvia dopo modifica
docker-compose restart fanta-f1

# Backup database
cp data/fantaf1.db data/fantaf1.db.bak

# Accedi alla shell del container
docker exec -it fanta-f1 sh

# Aggiorna l'app (dopo modifiche al codice)
docker-compose up -d --build
```

---

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
