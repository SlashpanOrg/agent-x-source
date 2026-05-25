import type { CommandInterface, CommandContext, CommandResult } from '../CommandInterface.js';

export const telegramCommand: CommandInterface = {
  name: 'telegram',
  description: 'Manage Telegram bot bridge',
  aliases: ['tg'],
  usage: '/telegram <start|stop|status> [bot_token]',
  async execute(args: string[], _context: CommandContext): Promise<CommandResult> {
    const subcommand = args[0]?.toLowerCase();

    switch (subcommand) {
      case 'start': {
        const token = args[1];
        if (!token) {
          return { success: false, output: 'Usage: /telegram start <bot_token>\nGet a token from @BotFather on Telegram.' };
        }
        return { success: true, output: `Starting Telegram bridge with token...`, action: 'telegram_start' };
      }
      case 'stop':
        return { success: true, output: 'Stopping Telegram bridge...', action: 'telegram_stop' };
      case 'status':
        return { success: true, output: '', action: 'telegram_status' };
      default:
        return {
          success: false,
          output: [
            'Telegram Bridge Commands:',
            '  /telegram start <token>  - Start the Telegram bot',
            '  /telegram stop           - Stop the bridge',
            '  /telegram status         - Show bridge status & setup guide',
            '',
            '━━━ How to get a bot token ━━━',
            '1. Open Telegram and search for @BotFather',
            '2. Send /newbot to create a new bot',
            '3. Follow the prompts to set a name and username',
            '4. BotFather will give you an API token (e.g. 123456:ABC-DEF1234...)',
            '5. Run: /telegram start <your_token>',
          ].join('\n'),
        };
    }
  },
};
