const express = require('express');
const session = require('express-session');
const redis = require('redis');
const RedisStore = require('connect-redis').default;
const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config();

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Redis Client erstellen
const redisClient = redis.createClient({
  socket: {
    host: process.env.REDIS_HOST || 'redis',
    port: 6379,
  },
  password: process.env.REDIS_PASSWORD || 'redispassword',
});

// Redis verbinden
(async () => {
  await redisClient.connect();
  console.log('Verbunden mit Redis');
})();

// Session-Konfiguration mit Redis
app.use(
  session({
    store: new RedisStore({ client: redisClient }),
    secret: process.env.SESSION_SECRET || 'secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false, // Für HTTPS auf true setzen
      maxAge: 1000 * 60 * 60 * 24, // 1 Tag
    },
  })
);

// MySQL Connection Pool
const createMySQLPool = () => {
  return mysql.createPool({
    host: process.env.MYSQL_HOST || 'mysql',
    user: process.env.MYSQL_USER || 'myappuser',
    password: process.env.MYSQL_PASSWORD || 'myapppassword',
    database: process.env.MYSQL_DATABASE || 'myappdb',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });
};

let mysqlPool = createMySQLPool();

// Datenbank initialisieren
async function initializeDatabase() {
  try {
    const connection = await mysqlPool.getConnection();

    // Tabelle für Benutzer erstellen
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Tabelle für Besucherzähler erstellen
    await connection.query(`
      CREATE TABLE IF NOT EXISTS visitor_count (
        id INT AUTO_INCREMENT PRIMARY KEY,
        count INT DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // Initialen Besucherzähler einfügen
    await connection.query(`
      INSERT IGNORE INTO visitor_count (id, count) VALUES (1, 0)
    `);

    connection.release();
    console.log('Datenbank initialisiert');
  } catch (error) {
    console.error('Datenbank-Initialisierungsfehler:', error);
  }
}

// Health Check Endpoint
app.get('/health', async (req, res) => {
  const healthcheck = {
    uptime: process.uptime(),
    message: 'OK',
    timestamp: Date.now(),
    services: {
      mysql: 'checking',
      redis: 'checking',
    },
  };

  try {
    // MySQL Health Check
    await mysqlPool.query('SELECT 1');
    healthcheck.services.mysql = 'healthy';
  } catch (error) {
    healthcheck.services.mysql = 'unhealthy';
    healthcheck.message = 'Service unavailable';
  }

  try {
    // Redis Health Check
    await redisClient.ping();
    healthcheck.services.redis = 'healthy';
  } catch (error) {
    healthcheck.services.redis = 'unhealthy';
    healthcheck.message = 'Service unavailable';
  }

  const allHealthy = Object.values(healthcheck.services).every(
    (status) => status === 'healthy'
  );

  res.status(allHealthy ? 200 : 503).json(healthcheck);
});

// Hauptroute
app.get('/', async (req, res) => {
  try {
    // Session-Counter erhöhen
    if (!req.session.views) {
      req.session.views = 1;
    } else {
      req.session.views++;
    }

    // Redis Cache für Seitenaufrufe
    const cacheKey = 'page_views_total';
    let totalViews = await redisClient.get(cacheKey);

    if (!totalViews) {
      // Aus MySQL holen, wenn nicht im Cache
      const [rows] = await mysqlPool.query(
        'SELECT count FROM visitor_count WHERE id = 1'
      );
      totalViews = rows[0]?.count || 0;

      // Im Redis für 60 Sekunden cachen
      await redisClient.setEx(cacheKey, 60, totalViews.toString());
    }

    // MySQL Besucherzähler erhöhen
    await mysqlPool.query(
      'UPDATE visitor_count SET count = count + 1 WHERE id = 1'
    );

    // Cache invalidieren
    await redisClient.del(cacheKey);

    res.render('index', {
      sessionViews: req.session.views,
      totalViews: parseInt(totalViews) + 1,
      hostname: process.env.HOSTNAME || 'localhost',
    });
  } catch (error) {
    console.error('Fehler:', error);
    res.status(500).send('Serverfehler');
  }
});

// API Endpoints
app.get('/api/users', async (req, res) => {
  try {
    const [rows] = await mysqlPool.query(
      'SELECT * FROM users ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/users', async (req, res) => {
  try {
    const { username, email } = req.body;
    const [result] = await mysqlPool.query(
      'INSERT INTO users (username, email) VALUES (?, ?)',
      [username, email]
    );
    res.json({ id: result.insertId, username, email });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Redis Cache Beispiel
app.get('/api/cache-test', async (req, res) => {
  const cacheKey = 'test_data';

  try {
    // Versuche aus Cache zu holen
    const cachedData = await redisClient.get(cacheKey);

    if (cachedData) {
      console.log('Daten aus Cache geladen');
      return res.json({
        source: 'cache',
        data: JSON.parse(cachedData),
        timestamp: new Date().toISOString(),
      });
    }

    // Wenn nicht im Cache, simuliere langsame Datenbankabfrage
    console.log('Daten aus Datenbank geladen');
    const data = {
      message: 'Diese Daten wurden aus der Datenbank geladen',
      generated: new Date().toISOString(),
      value: Math.random(),
    };

    // Im Redis für 30 Sekunden speichern
    await redisClient.setEx(cacheKey, 30, JSON.stringify(data));

    res.json({
      source: 'database',
      data: data,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Server starten
const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    // Datenbank initialisieren
    await initializeDatabase();

    app.listen(PORT, () => {
      console.log(`Server läuft auf http://localhost:${PORT}`);
      console.log(`MySQL Host: ${process.env.MYSQL_HOST}`);
      console.log(`Redis Host: ${process.env.REDIS_HOST}`);
    });
  } catch (error) {
    console.error('Server-Startfehler:', error);
    process.exit(1);
  }
}

startServer();

// Graceful Shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM empfangen, Server wird heruntergefahren...');
  await redisClient.quit();
  await mysqlPool.end();
  process.exit(0);
});
