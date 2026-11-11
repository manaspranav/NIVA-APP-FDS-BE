/**
 * Script to create new partner: 9299950587 / fastfood123
 * 
 * This script:
 * 1. Creates a Supabase Auth user (Supabase handles password hashing internally)
 * 2. Inserts/updates partners table with supabase_id, hidePrices=true, and slot defaults
 * 
 * IMPORTANT: Do NOT hash password before sending to Supabase — it handles hashing internally.
 * 
 * Usage: node create-partner.js
 */

const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function createPartner() {
  const phone = '9299950587';
  const password = 'fastfood123';
  const name = 'Fast Food Partner';
  const email = `${phone}@partner.com`;

  console.log('Creating partner:', phone);
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
        role: 'partner'
      },
      app_metadata: {
        role: 'partner'
      }
    });

    let supabaseUserId = null;

    if (authError) {
      if (authError.message.includes('already been registered')) {
        console.log('Auth user already exists, fetching user ID...');
        
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
              user_metadata: { name, phone, role: 'partner' },
              app_metadata: { role: 'partner' }
            });
            if (updateError) {
              console.error('Warning: Could not update user password:', updateError.message);
            } else {
              console.log('Updated user password and metadata');
            }
          }
        }
      } else {
        console.error('Error creating auth user:', authError);
        return;
      }
    } else {
      supabaseUserId = authData.user.id;
      console.log('Supabase Auth user created:', supabaseUserId);
    }

    if (!supabaseUserId) {
      console.error('Could not determine Supabase user ID. Aborting.');
      return;
    }

    // 2. Check if partner already exists in partners table
    const { data: existing } = await supabase
      .from('partners')
      .select('id')
      .eq('phone', phone)
      .maybeSingle();

    if (existing) {
      // Update existing partner
      const updateData = {
        name: name,
        password: password,
        hide_prices: true,
        lunch_slot_active: true,
        evening_slot_active: true,
        active: true,
        role: 'partner'
      };

      // Try with supabase_id first, fall back without if column doesn't exist
      let data, error;
      ({ data, error } = await supabase
        .from('partners')
        .update({ ...updateData, supabase_id: supabaseUserId })
        .eq('phone', phone)
        .select()
        .single());

      if (error && error.message.includes('supabase_id')) {
        console.log('supabase_id column not found, inserting without it...');
        ({ data, error } = await supabase
          .from('partners')
          .update(updateData)
          .eq('phone', phone)
          .select()
          .single());
      }

      if (error) {
        console.error('Error updating partner:', error);
        return;
      }
      console.log('Partner updated successfully:', { id: data.id, phone: data.phone, name: data.name });
    } else {
      // Insert new partner
      const insertData = {
        name: name,
        phone: phone,
        password: password,
        hide_prices: true,
        lunch_slot_active: true,
        evening_slot_active: true,
        active: true,
        role: 'partner'
      };

      // Try with supabase_id first, fall back without if column doesn't exist
      let data, error;
      ({ data, error } = await supabase
        .from('partners')
        .insert([{ ...insertData, supabase_id: supabaseUserId }])
        .select()
        .single());

      if (error && error.message.includes('supabase_id')) {
        console.log('supabase_id column not found, inserting without it...');
        ({ data, error } = await supabase
          .from('partners')
          .insert([insertData])
          .select()
          .single());
      }

      if (error) {
        console.error('Error creating partner:', error);
        return;
      }
      console.log('Partner created successfully:', { id: data.id, phone: data.phone, name: data.name });
    }

    console.log('\n✅ Partner setup complete!');
    console.log('Phone:', phone);
    console.log('Email (Supabase):', email);
    console.log('Password:', password);
    console.log('Supabase User ID:', supabaseUserId);
    console.log('Hide Prices: true');
    console.log('Slot Control: lunch=active, evening=active');

  } catch (error) {
    console.error('Unexpected error:', error);
  }
}

createPartner();
