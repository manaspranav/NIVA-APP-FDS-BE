#!/usr/bin/env node

/**
 * PAYMENT CREATE-ORDER DIAGNOSTIC RUNNER
 * 
 * Quick diagnostic to identify 400 errors from /api/payment/create-order
 * Run with: node run-payment-diagnostics.js
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(color, ...args) {
  console.log(color, ...args, colors.reset);
}

async function runDiagnostics() {
  // Initialize Supabase client
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    log(colors.red, '❌ ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const checks = [];

  log(colors.cyan, '\n═══════════════════════════════════════════════════════════════');
  log(colors.cyan, '📊 PAYMENT CREATE-ORDER DIAGNOSTIC RUNNER');
  log(colors.cyan, '═══════════════════════════════════════════════════════════════\n');

  // ============================
  // Check 1: Vendors
  // ============================
  log(colors.blue, '✓ Check 1: Vendor Configuration');
  const { data: vendors, error: vendorError } = await supabase
    .from('vendors')
    .select('id, name, is_active')
    .limit(5);

  if (vendorError) {
    log(colors.red, `  ❌ vendors table error: ${vendorError.message}`);
    checks.push({ name: 'Vendor Query', status: 'FAIL' });
  } else if (!vendors || vendors.length === 0) {
    log(colors.red, `  ❌ No vendors found in database`);
    checks.push({ name: 'Vendor Exists', status: 'FAIL' });
  } else {
    log(colors.green, `  ✅ Found ${vendors.length} vendor(s):`);
    vendors.forEach((v, i) => {
      const status = v.is_active ? '✅ ACTIVE' : '❌ INACTIVE';
      log(colors.reset, `     ${i + 1}. ${v.name} (${v.id.substring(0, 8)}...) - ${status}`);
    });
    checks.push({ name: 'Vendor Exists', status: 'PASS' });

    // ============================
    // Check 2: Vendor Settings (only if vendor exists)
    // ============================
    log(colors.blue, '\n✓ Check 2: Vendor Settings');
    const vendorId = vendors.find(v => v.is_active)?.id || vendors[0].id;

    const { data: settings, error: settingsError } = await supabase
      .from('vendor_settings')
      .select('*')
      .eq('vendor_id', vendorId)
      .single();

    if (settingsError) {
      log(colors.red, `  ❌ vendor_settings not found for vendor ${vendorId.substring(0, 8)}...`);
      log(colors.yellow, `     CREATE: INSERT INTO vendor_settings (vendor_id, is_open, accepting_orders, lunch_slot_active, evening_slot_active, fast_foods_active, biryani_active) VALUES ('${vendorId}', true, true, true, true, true, true)`);
      checks.push({ name: 'Vendor Settings', status: 'FAIL' });
    } else {
      const settings_status = [];
      if (settings.is_open !== false) settings_status.push('open');
      if (settings.accepting_orders !== false) settings_status.push('accepting');
      if (settings.lunch_slot_active !== false) settings_status.push('lunch');
      if (settings.evening_slot_active !== false) settings_status.push('evening');
      if (settings.fast_foods_active !== false) settings_status.push('fastfood');
      if (settings.biryani_active !== false) settings_status.push('biryani');

      log(colors.green, `  ✅ Vendor Settings Found:`);
      log(colors.reset, `     - is_open: ${settings.is_open !== false ? '✅ true' : '❌ false'}`);
      log(colors.reset, `     - accepting_orders: ${settings.accepting_orders !== false ? '✅ true' : '❌ false'}`);
      log(colors.reset, `     - lunch_slot_active: ${settings.lunch_slot_active !== false ? '✅ true' : '❌ false'}`);
      log(colors.reset, `     - evening_slot_active: ${settings.evening_slot_active !== false ? '✅ true' : '❌ false'}`);
      log(colors.reset, `     - fast_foods_active: ${settings.fast_foods_active !== false ? '✅ true' : '❌ false'}`);
      log(colors.reset, `     - biryani_active: ${settings.biryani_active !== false ? '✅ true' : '❌ false'}`);

      if (settings_status.length === 6) {
        checks.push({ name: 'Vendor Settings', status: 'PASS' });
      } else {
        log(colors.yellow, `\n  ⚠️  FIX: Some settings disabled. Update with:`);
        log(colors.yellow, `     UPDATE vendor_settings SET is_open=true, accepting_orders=true, lunch_slot_active=true, evening_slot_active=true, fast_foods_active=true, biryani_active=true WHERE vendor_id='${vendorId}'`);
        checks.push({ name: 'Vendor Settings', status: 'PARTIAL' });
      }
    }
  }

  // ============================
  // Check 3: Menu Items
  // ============================
  log(colors.blue, '\n✓ Check 3: Menu Items / Products');
  const { data: menuItems, error: menuError } = await supabase
    .from('menu_items')
    .select('count')
    .eq('in_stock', true);

  if (!menuError && menuItems && menuItems.length > 0) {
    log(colors.green, `  ✅ ${menuItems.length} menu items in stock (admin-added products)`);
    checks.push({ name: 'Menu Items', status: 'PASS' });
  } else {
    log(colors.yellow, `  ℹ️  No admin-added menu items (OK if using hardcoded catalog IDs 301-316)`);
    checks.push({ name: 'Menu Items', status: 'INFO' });
  }

  // ============================
  // Check 4: Pending Orders Schema
  // ============================
  log(colors.blue, '\n✓ Check 4: Database Schema (pending_orders)');
  const { data: pendingTest, error: pendingError } = await supabase
    .from('pending_orders')
    .select('*')
    .limit(1);

  if (pendingError) {
    log(colors.red, `  ❌ pending_orders table error: ${pendingError.message}`);
    checks.push({ name: 'pending_orders Schema', status: 'FAIL' });
  } else {
    if (pendingTest && pendingTest.length > 0) {
      const columns = Object.keys(pendingTest[0]);
      const hasRestaurantId = columns.includes('restaurant_id');
      const hasVendorName = columns.includes('vendor_name');

      log(colors.green, `  ✅ pending_orders table accessible`);
      log(colors.reset, `     - Has restaurant_id: ${hasRestaurantId ? '✅' : '❌'}`);
      log(colors.reset, `     - Has vendor_name: ${hasVendorName ? '✅' : '❌'}`);

      if (hasRestaurantId && hasVendorName) {
        checks.push({ name: 'pending_orders Schema', status: 'PASS' });
      } else {
        log(colors.yellow, `\n  ⚠️  FIX: Add missing columns with:`);
        log(colors.yellow, `     ALTER TABLE pending_orders ADD COLUMN IF NOT EXISTS restaurant_id uuid, ADD COLUMN IF NOT EXISTS vendor_name text;`);
        checks.push({ name: 'pending_orders Schema', status: 'PARTIAL' });
      }
    } else {
      log(colors.green, `  ✅ pending_orders table exists (no data yet)`);
      checks.push({ name: 'pending_orders Schema', status: 'PASS' });
    }
  }

  // ============================
  // Summary
  // ============================
  log(colors.cyan, '\n═══════════════════════════════════════════════════════════════');
  log(colors.cyan, '📋 DIAGNOSTIC SUMMARY');
  log(colors.cyan, '═══════════════════════════════════════════════════════════════\n');

  let passCount = 0;
  let failCount = 0;

  checks.forEach(check => {
    if (check.status === 'PASS') {
      log(colors.green, `  ✅ ${check.name.padEnd(25)} PASS`);
      passCount++;
    } else if (check.status === 'FAIL') {
      log(colors.red, `  ❌ ${check.name.padEnd(25)} FAIL`);
      failCount++;
    } else if (check.status === 'PARTIAL') {
      log(colors.yellow, `  ⚠️  ${check.name.padEnd(25)} PARTIAL`);
    } else {
      log(colors.blue, `  ℹ️  ${check.name.padEnd(25)} INFO`);
    }
  });

  log(colors.cyan, '\n═══════════════════════════════════════════════════════════════');

  if (failCount === 0) {
    log(colors.green, '\n✅ All critical checks passed!');
    log(colors.reset, '\nYour configuration looks good. If you still see 400 errors:');
    log(colors.reset, '  1. Check the exact error message in browser Network tab');
    log(colors.reset, '  2. Look for [CREATE-ORDER] logs in your backend console');
    log(colors.reset, '  3. Verify cart items exist (IDs 301-316 or valid menu_items UUIDs)');
    log(colors.reset, '  4. Ensure deliverySlot matches: "12:00 - 2:00 PM" or "6:30 - 9:00 PM"');
  } else {
    log(colors.red, `\n❌ ${failCount} critical issue(s) found. Fix the items marked above.`);
  }

  log(colors.cyan, '\n═══════════════════════════════════════════════════════════════\n');
}

// Run diagnostics
runDiagnostics().catch(error => {
  log(colors.red, '\n❌ Diagnostic error:', error.message);
  process.exit(1);
});
