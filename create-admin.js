/**
 * Script to create admin user in Supabase Auth
 * 
 * This script:
 * 1. Creates a Supabase Auth user with admin role
 * 2. Sets the phone number as metadata
 * 
 * IMPORTANT: Do NOT hash password before sending to Supabase — it handles hashing internally.
 * 
 * Usage: node create-admin.js
 */

const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function createAdmin() {
  const phone = '9392980823';
  const password = 'Niva@2007';
  const name = 'Admin User';
  const email = `${phone}@admin.niva.in`;

  console.log('Creating admin user:', phone);
  console.log('Supabase email:', email);

  try {
    // 1. Create Supabase Auth user — Supabase handles password hashing internally
    //    DO NOT hash with bcrypt before passing to Supabase
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: email,
      password: password, // Plain text — Supabase hashes internally
      email_confirm: true,
      user_metadata: {
        name: name,
        phone: phone,
        role: 'admin'
      },
      app_metadata: {
        role: 'admin'
      }
    });

    let supabaseUserId = null;

    if (authError) {
      if (authError.message.includes('already been registered')) {
        console.log('Auth user already exists, updating password...');
        
        // Fetch existing user by email to get their ID
        const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
        if (!listError && users) {
          const existingUser = users.find(u => u.email === email);
          if (existingUser) {
            supabaseUserId = existingUser.id;
            console.log('Found existing user ID:', supabaseUserId);
            
            // Update password in case it changed
            const { error: updateError } = await supabase.auth.admin.updateUserById(supabaseUserId, {
              password: password,
              user_metadata: { name, phone, role: 'admin' },
              app_metadata: { role: 'admin' }
            });
            if (updateError) {
              console.error('Error updating user password:', updateError.message);
              return;
            } else {
              console.log('✅ Updated user password and metadata');
            }
          }
        }
      } else {
        console.error('Error creating auth user:', authError);
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

    console.log('\n✅ Admin setup complete!');
    console.log('Phone:', phone);
    console.log('Email (Supabase):', email);
    console.log('Password:', password);
    console.log('Supabase User ID:', supabaseUserId);
    console.log('\nYou can now log in at the admin login page.');

  } catch (error) {
    console.error('Unexpected error:', error);
  }
}

createAdmin();
