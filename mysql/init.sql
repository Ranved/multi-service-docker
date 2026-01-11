-- Datenbank initialisieren
-- Diese Skript wird beim ersten Start von MySQL ausgeführt

-- Zusätzliche Berechtigungen für den Anwendungsbenutzer
GRANT ALL PRIVILEGES ON myappdb.* TO 'myappuser'@'%';
FLUSH PRIVILEGES;

-- Beispiel-Daten 
INSERT IGNORE INTO users (username, email) VALUES
('admin', 'admin@example.com'),
('user1', 'user1@example.com'),
('user2', 'user2@example.com');