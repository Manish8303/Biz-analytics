// --- REQUIRED MODULES ---
const express = require('express');
const cors = require('cors');
const path = require('path');
const mysql = require('mysql2/promise'); 

const app = express();
const PORT = 5001;

// --- MIDDLEWARE CONFIGURATION ---
app.use(cors()); 
app.use(express.static(path.join(__dirname, '/')));

// --- DATABASE CONFIGURATION ---
const dbConfig = {
    host: 'localhost',      
    user: 'root',           
    password: 'password', // <--- IMPORTANT: REPLACE THIS WITH YOUR ACTUAL PASSWORD!
    database: 'analytics_db'
};

// --- DATABASE HELPER FUNCTION ---
async function queryDatabase(sql, params = []) {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        console.log("Executing SQL:", sql.substring(0, 80).replace(/\n/g, ' ') + '...');
        const [rows] = await connection.execute(sql, params);
        return rows;
    } catch (error) {
        console.error("CRITICAL: Database Query Error:", error.message);
        throw new Error("Failed to fetch data from MySQL. Check database connection and SQL syntax.");
    } finally {
        if (connection) connection.end();
    }
}

// ------------------------------------------------------------------
// 💡 CENTRAL FILTERING LOGIC (EXPANDED)
// ------------------------------------------------------------------

/**
 * Builds the WHERE clause and parameter array based on user filters.
 * Now includes region, product_name, sales_channel, and product_category.
 * @param {object} query - req.query object from Express.
 * @returns {{whereClause: string, params: Array}}
 */
function buildFilter(query) {
    const filters = [];
    const params = [];

    // Filter by Region
    if (query.region && query.region !== 'All') {
        filters.push('region = ?');
        params.push(query.region);
    }
    // Filter by Product Name
    if (query.product && query.product !== 'All') {
        filters.push('product_name = ?');
        params.push(query.product);
    }
    // Filter by Sales Channel
    if (query.channel && query.channel !== 'All') { 
        filters.push('sales_channel = ?');
        params.push(query.channel);
    }
    // Filter by Product Category
    if (query.category && query.category !== 'All') { 
        filters.push('product_category = ?');
        params.push(query.category);
    }
    // Note: Customer Tier is not used for general filtering, but for a specific aggregation chart.

    const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
    return { whereClause, params };
}

// --- API ENDPOINTS ---

app.get('/api/kpis', async (req, res) => {
    try {
        const { whereClause, params } = buildFilter(req.query);
        
        // Query 1: Get filtered revenue, orders, and customers
        const sql = `
            SELECT 
                SUM(revenue) AS revenue, 
                COUNT(order_id) AS orders, 
                COUNT(DISTINCT customer_id) AS customers
            FROM sales_data
            ${whereClause};
        `;
        const results = await queryDatabase(sql, params);
        const kpis = results[0];

        // Query 2: Get revenue for growth calculation
        const growthSql = `
            SELECT 
                DATE_FORMAT(order_date, '%Y-%m') AS month_year, 
                SUM(revenue) AS monthly_revenue
            FROM sales_data
            ${whereClause}
            GROUP BY month_year
            ORDER BY month_year ASC;
        `;
        const growthResults = await queryDatabase(growthSql, params);

        let growth = 0;
        if (growthResults.length >= 2) {
            const firstMonthRev = growthResults[0].monthly_revenue;
            const lastMonthRev = growthResults[growthResults.length - 1].monthly_revenue;
            if (firstMonthRev > 0) {
                // Calculate percentage growth between first and last month available in the filtered set
                growth = parseFloat((((lastMonthRev - firstMonthRev) / firstMonthRev) * 100).toFixed(1));
            }
        }
        
        res.json({
            ...kpis,
            growth: growth,
            revenue: parseFloat(kpis.revenue || 0),
            customers: parseInt(kpis.customers || 0),
            orders: parseInt(kpis.orders || 0)
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Sales by Month (Line/Bar Chart)
app.get('/api/sales', async (req, res) => {
    try {
        const { whereClause, params } = buildFilter(req.query);

        const sql = `
            SELECT 
                DATE_FORMAT(order_date, '%b') AS label, 
                SUM(revenue) AS value,
                DATE_FORMAT(order_date, '%Y-%m') AS sort_order
            FROM sales_data
            ${whereClause}
            GROUP BY label, sort_order
            ORDER BY sort_order;
        `;
        const results = await queryDatabase(sql, params);

        const labels = results.map(row => row.label);
        const data = results.map(row => parseFloat(row.value));

        res.json({ labels, data });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Top Products (Horizontal Bar)
app.get('/api/products', async (req, res) => {
    try {
        const { whereClause, params } = buildFilter(req.query);

        const sql = `
            SELECT 
                product_name AS label, 
                SUM(revenue) AS value
            FROM sales_data
            ${whereClause}
            GROUP BY product_name
            ORDER BY value DESC
            LIMIT 5;
        `;
        const results = await queryDatabase(sql, params);

        const labels = results.map(row => row.label);
        const data = results.map(row => parseFloat(row.value));

        res.json({ labels, data });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Region Performance (Pie Chart)
app.get('/api/regions', async (req, res) => {
    try {
        const { whereClause, params } = buildFilter(req.query);
        
        const regionalSql = `
            SELECT 
                region AS label, 
                SUM(revenue) AS value
            FROM sales_data
            ${whereClause}
            GROUP BY region;
        `;
        const regionalResults = await queryDatabase(regionalSql, params);

        const labels = regionalResults.map(row => row.label);
        const data = regionalResults.map(row => parseFloat(row.value));

        res.json({ labels, data });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});


// ------------------------------------------------------------------
// 📊 NEW ENDPOINTS FOR RICHER ANALYSIS
// ------------------------------------------------------------------

// Revenue by Sales Channel (Bar Chart)
app.get('/api/channels', async (req, res) => {
    try {
        const { whereClause, params } = buildFilter(req.query);

        const sql = `
            SELECT 
                sales_channel AS label, 
                SUM(revenue) AS value
            FROM sales_data
            ${whereClause}
            GROUP BY sales_channel
            ORDER BY value DESC;
        `;
        const results = await queryDatabase(sql, params);

        const labels = results.map(row => row.label);
        const data = results.map(row => parseFloat(row.value));

        res.json({ labels, data });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Revenue by Customer Tier (Doughnut Chart)
app.get('/api/tiers', async (req, res) => {
    try {
        // We still use the general filter (region, product, etc.) but group by tier
        const { whereClause, params } = buildFilter(req.query);

        const sql = `
            SELECT 
                customer_tier AS label, 
                SUM(revenue) AS value
            FROM sales_data
            ${whereClause}
            GROUP BY customer_tier
            ORDER BY FIELD(customer_tier, 'Platinum', 'Gold', 'Silver', 'Bronze');
        `;
        const results = await queryDatabase(sql, params);

        const labels = results.map(row => row.label);
        const data = results.map(row => parseFloat(row.value));

        res.json({ labels, data });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// --- API ENDPOINT FOR DROPDOWN METADATA ---
app.get('/api/metadata', async (req, res) => {
    try {
        const regions = await queryDatabase("SELECT DISTINCT region FROM sales_data ORDER BY region;");
        const products = await queryDatabase("SELECT DISTINCT product_name FROM sales_data ORDER BY product_name;");
        const channels = await queryDatabase("SELECT DISTINCT sales_channel FROM sales_data ORDER BY sales_channel;");
        const categories = await queryDatabase("SELECT DISTINCT product_category FROM sales_data ORDER BY product_category;");

        res.json({ 
            regions: regions.map(r => r.region), 
            products: products.map(p => p.product_name),
            channels: channels.map(c => c.sales_channel),
            categories: categories.map(c => c.product_category)
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// --- SERVER START ---
app.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`🚀 Node.js Backend Running on http://localhost:${PORT}`);
    console.log(`Ready for advanced queries!`);
    console.log(`======================================================\n`);
});
