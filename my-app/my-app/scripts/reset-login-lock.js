#!/usr/bin/env node

/**
 * Reset Login Lock Script
 * 
 * This script resets the login disabled state and manual override lock
 * when direct database access is needed to re-enable logins.
 * 
 * Usage: npm run reset-login-lock
 * 
 * 
 * Note: This serves as a contingecy for situations of which the Admin Page is somehow compomised, killing all sessions and login attempts to prevent additional writing to the AD Environment. -Tommy
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function resetLoginLock() {
  try {
    console.log('🔍 Checking current system settings...\n');

    // Get current settings
    const currentSettings = await prisma.systemSettings.findFirst({
      orderBy: { createdAt: 'desc' },
    });

    if (!currentSettings) {
      console.log('⚠️  No system settings found. Creating default settings...');
      await prisma.systemSettings.create({
        data: {
          loginDisabled: false,
          internalRegistrationDisabled: false,
          externalRegistrationDisabled: false,
          manualOverride: false,
          lastModifiedBy: 'reset-script',
        },
      });
      console.log('✅ Default settings created successfully!');
      return;
    }

    console.log('Current Settings:');
    console.log('├─ Login Disabled:', currentSettings.loginDisabled);
    console.log('├─ Manual Override:', currentSettings.manualOverride);
    console.log('├─ Last Modified By:', currentSettings.lastModifiedBy || 'N/A');
    console.log('└─ Last Updated:', currentSettings.updatedAt.toISOString());
    console.log('');

    if (!currentSettings.loginDisabled && !currentSettings.manualOverride) {
      console.log('ℹ️  Logins are already enabled and not locked. No action needed.');
      return;
    }

    console.log('🔓 Resetting login lock...\n');

    // Update settings
    const updatedSettings = await prisma.systemSettings.update({
      where: { id: currentSettings.id },
      data: {
        loginDisabled: false,
        manualOverride: false,
        lastModifiedBy: 'reset-script',
      },
    });

    console.log('✅ Login lock reset successfully!\n');
    console.log('Updated Settings:');
    console.log('├─ Login Disabled:', updatedSettings.loginDisabled);
    console.log('├─ Manual Override:', updatedSettings.manualOverride);
    console.log('├─ Last Modified By:', updatedSettings.lastModifiedBy);
    console.log('└─ Last Updated:', updatedSettings.updatedAt.toISOString());
    console.log('');
    console.log('🎉 Users can now log in to the application!');

  } catch (error) {
    console.error('❌ Error resetting login lock:');
    console.error(error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
resetLoginLock()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Unexpected error:', error);
    process.exit(1);
  });
