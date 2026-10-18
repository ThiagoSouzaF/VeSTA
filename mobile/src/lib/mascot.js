import idle from '../../../assets/mascot/state-idle.webp';
import thinking from '../../../assets/mascot/state-thinking.webp';
import working from '../../../assets/mascot/state-working.webp';
import success from '../../../assets/mascot/state-success.webp';
import error from '../../../assets/mascot/state-error.webp';
import sleeping from '../../../assets/mascot/state-sleeping.webp';

export const MASCOT = { idle, thinking, working, success, error, sleeping };
export const MOOD_LABEL = {
  idle: 'Pronto',
  thinking: 'Pensando',
  working: 'Trabalhando',
  success: 'Concluído',
  error: 'Com problema',
  sleeping: 'Sem conexão',
};
