const dotenv = require('dotenv');
const { getSupabase } = require('./lib/supabase');

dotenv.config();

async function searchRestaurant() {
  try {
    const searchTerm = 'localhome';
    const supabase = getSupabase();
    
    // Search by name (case-insensitive)
    const { data: restaurants, error } = await supabase
      .from('restaurants')
      .select('id, name, owner_phone, owner_password_hash, is_active')
      .ilike('name', `%${searchTerm}%`);

    if (error) {
      console.error('Search error:', error.message);
      return;
    }

    if (restaurants.length === 0) {
      console.log(`No restaurants found with name containing "${searchTerm}"`);
      console.log('\nAll restaurants in database:');
      const { data: all } = await supabase
        .from('restaurants')
        .select('id, name, owner_phone, owner_password_hash, is_active');
      
      all.forEach(r => {
        console.log(`  - ${r.name} (${r.is_active ? 'active' : 'inactive'}) - Phone: ${r.owner_phone || 'NOT SET'}`);
      });
    } else {
      console.log(`Found restaurants matching "${searchTerm}":`);
      restaurants.forEach(r => {
        const hashStatus = r.owner_password_hash ? '✓ SET' : '✗ NOT SET';
        console.log(`\n  Name: ${r.name}`);
        console.log(`  ID: ${r.id}`);
        console.log(`  Active: ${r.is_active}`);
        console.log(`  Phone: ${r.owner_phone || 'NOT SET'}`);
        console.log(`  Password Hash: ${hashStatus}`);
      });
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
}

searchRestaurant();
