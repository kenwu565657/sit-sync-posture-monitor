import pool from './src/db.js';
import bcrypt from 'bcrypt';

async function seedDatabase() {
    console.log('🌱 Starting database seed...');

    try {
        // 1. Clear existing data to prevent duplicates during testing
        await pool.query('TRUNCATE TABLE posture_events CASCADE');
        await pool.query('TRUNCATE TABLE users CASCADE');
        console.log('🗑️  Cleared old data.');

        // 2. Create hashed passwords
        const saltRounds = 10;
        const passwordHash1 = await bcrypt.hash('password123', saltRounds);
        const passwordHash2 = await bcrypt.hash('admin123', saltRounds);

        // 3. Insert Test Users
        const user1 = await pool.query(
            `INSERT INTO users (name, email, password_hash, role) 
             VALUES ($1, $2, $3, $4) RETURNING id`,
            ['Alex Test', 'alex@example.com', passwordHash1, 'user']
        );
        const alexId = user1.rows[0].id;

        const user2 = await pool.query(
            `INSERT INTO users (name, email, password_hash, role) 
             VALUES ($1, $2, $3, $4) RETURNING id`,
            ['Dr. Sarah', 'sarah@example.com', passwordHash2, 'admin']
        );
        console.log('👤 Created test users (alex@example.com & sarah@example.com).');

        // 4. Insert Fake Posture History for Alex (to light up the dashboard)
        console.log('📊 Generating fake posture events for Alex...');
        for (let i = 0; i < 15; i++) {
            // Generate random events over the last 14 days
            const daysAgo = Math.floor(Math.random() * 14);
            const duration = Math.floor(Math.random() * 300) + 15; // 15s to 5 mins
            const score = Math.floor(Math.random() * 4) + 4; // RULA 4 to 7
            const minimumCva = Math.floor(Math.random() * 21) + 25; // CVA 25 to 45
            const type = score > 5 ? 'critical' : 'warning';
            
            await pool.query(
                `INSERT INTO posture_events
                    (user_id, event_type, duration_seconds, peak_rula_score,
                     minimum_cva_angle, logged_at)
                 VALUES ($1, $2, $3, $4, $5, NOW() - INTERVAL '${daysAgo} days' - INTERVAL '${Math.floor(Math.random() * 10)} hours')`,
                [alexId, type, duration, score, minimumCva]
            );
        }

        console.log('✅ Seeding complete! You can now log in.');
        process.exit(0);

    } catch (error) {
        console.error('❌ Seeding failed:', error);
        process.exit(1);
    }
}

seedDatabase();