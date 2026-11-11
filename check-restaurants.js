const dotenv = require('dotenv');
const { getSupabase } = require('./lib/supabase');

dotenv.config();

async function checkRestaurants() {
  try {
    const supabase = getSupabase();
    const { data: restaurants, error } = await supabase
      .from('restaurants')
      .select('id, name, owner_phone, owner_password_hash')
      .limit(20);

    if (error) {
      console.error('Database error:', error.message);
      return;
    }

    console.log('Found', restaurants.length, 'restaurants:\n');
    restaurants.forEach(r => {
      const hashStatus = r.owner_password_hash ? '✓ SET' : '✗ NOT SET';
      const phoneStatus = r.owner_phone ? '✓' : '✗';
      console.log(`ID: ${r.id}`);
      console.log(`  Name: ${r.name}`);
      console.log(`  Phone: ${r.owner_phone || 'NOT SET'} ${phoneStatus}`);
      console.log(`  Password Hash: ${hashStatus}`);
      console.log('');
    });
  } catch (err) {
    console.error('Error:', err.message);
  }
}

checkRestaurants();
