/**
 * Script to create/update restaurant owner in Supabase Auth
 * 
 * This script:
 * 1. Creates a Supabase Auth user with restaurant_owner role
 * 2. Links it to the restaurants table
 * 3. Uses the owner_phone and owner_password_hash from the restaurants table
 * 
 * IMPORTANT: Do NOT hash password before sending to Supabase — it handles hashing internally.
 * The password parameter should be the PLAIN PASSWORD (not the bcrypt hash from the DB).
 * 
 * Usage: node create-restaurant.js [restaurantId] [phone] [password]
 * Example: node create-restaurant.js res_123 9876543210 MyPassword123
 */

const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function createRestaurant() {
  const args = process.argv.slice(2);
  
  if (args.length < 3) {
    console.log('Usage: node create-restaurant.js [restaurantId] [phone] [password]');
    console.log('Example: node create-restaurant.js res_123 9876543210 MyPassword123');
    process.exit(1);
  }

  const restaurantId = args[0];
  const phone = args[1];
  const password = args[2];
  const syntheticEmail = `${phone}@restaurant.niva.in`;

  console.log('Creating/updating restaurant owner authentication...');
  console.log('Restaurant ID:', restaurantId);
  console.log('Phone:', phone);
  console.log('Supabase email:', syntheticEmail);

  try {
    // 1. Fetch restaurant from database to verify it exists
    const { data: restaurant, error: fetchError } = await supabase
      .from('restaurants')
      .select('id, name, owner_phone, owner_password_hash')
      .eq('id', restaurantId)
      .single();

    if (fetchError || !restaurant) {
      console.error('Error: Restaurant not found with ID:', restaurantId);
      console.error('Fetch error:', fetchError?.message);
      return;
    }

    console.log('Found restaurant:', restaurant.name);

    // 2. Verify phone matches restaurant owner_phone
    if (restaurant.owner_phone !== phone) {
      console.error('Error: Phone number does not match restaurant owner phone');
      console.error('Expected:', restaurant.owner_phone);
      console.error('Got:', phone);
      return;
    }

    // 3. Create or update Supabase Auth user with restaurant_owner role
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: syntheticEmail,
      password: password, // Plain text — Supabase hashes internally
      email_confirm: true,
      user_metadata: {
        name: restaurant.name,
        phone: phone,
        role: 'restaurant_owner',
        restaurantId: restaurantId
      },
      app_metadata: {
        role: 'restaurant_owner',
        restaurantId: restaurantId
      }
    });

    let supabaseUserId = null;

    if (authError) {
      if (authError.message.includes('already been registered')) {
        console.log('Auth user already exists, updating password and metadata...');
        
        // Fetch existing user by email to get their ID
        const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
        if (!listError && users) {
          const existingUser = users.find(u => u.email === syntheticEmail);
          if (existingUser) {
            supabaseUserId = existingUser.id;
            console.log('Found existing user ID:', supabaseUserId);
            
            // Update password and metadata
            const { error: updateError } = await supabase.auth.admin.updateUserById(supabaseUserId, {
              password: password,
              user_metadata: {
                name: restaurant.name,
                phone: phone,
                role: 'restaurant_owner',
                restaurantId: restaurantId
              },
              app_metadata: {
                role: 'restaurant_owner',
                restaurantId: restaurantId
              }
            });
            if (updateError) {
              console.error('Error updating user:', updateError.message);
              return;
            } else {
              console.log('✅ Updated user password and metadata');
            }
          } else {
            console.error('Could not find existing user with email:', syntheticEmail);
            return;
          }
        } else {
          console.error('Error fetching users:', listError?.message);
          return;
        }
      } else {
        console.error('Error creating auth user:', authError.message);
        return;
      }
    } else {
      supabaseUserId = authData.user.id;
      console.log('✅ Supabase Auth user created:', supabaseUserId);
    }

    if (!supabaseUserId) {
      console.error('Could not determine Supabase user ID. Aborting.');
      return;
    }

    // 4. Update restaurants table with supabase_id (optional, for audit trail)
    // NOTE: Make sure your restaurants table has a supabase_id column
    const { error: updateError } = await supabase
      .from('restaurants')
      .update({ supabase_id: supabaseUserId })
      .eq('id', restaurantId)
      .select()
      .single();

    if (updateError && !updateError.message.includes('supabase_id')) {
      console.warn('Warning: Could not update restaurants table with supabase_id:', updateError.message);
      // Not critical — auth user is still created
    } else if (!updateError) {
      console.log('✅ Updated restaurants table with supabase_id');
    }

    console.log('\n✅ Restaurant owner authentication setup complete!');
    console.log('Restaurant:', restaurant.name);
    console.log('Phone:', phone);
    console.log('Email (Supabase):', syntheticEmail);
    console.log('Password: (as provided)');
    console.log('Supabase User ID:', supabaseUserId);
    console.log('\nThe restaurant owner can now log in at: /restaurant-portal/login');

  } catch (error) {
    console.error('Unexpected error:', error);
  }
}

createRestaurant();
