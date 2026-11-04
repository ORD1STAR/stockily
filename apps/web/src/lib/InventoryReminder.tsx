import { Link } from 'react-router-dom';
import { InventoryReminderStatus } from './api';
import { Icon } from './Icon';

/** "Inventaire à faire" banner — shown when the reminder set in Paramètres is due. */
export function ReminderBanner({ reminder, withLink }: { reminder: InventoryReminderStatus; withLink?: boolean }) {
  if (reminder.frequency === 'off' || !reminder.isDue) return null;
  return (
    <div className="reminder-banner">
      <Icon name="clock" size={18} />
      <span>
        <b>Inventaire à faire</b> ({reminder.frequencyLabel.toLowerCase()})
        {reminder.lastInventoryAt ? ` · dernier inventaire le ${new Date(reminder.lastInventoryAt).toLocaleDateString('fr-FR')}` : ' · aucun inventaire validé'}
        {reminder.inProgress > 0 && ' · un inventaire est déjà en cours'}
      </span>
      {withLink && (
        <Link className="btn-secondary btn-sm" to="/inventory">
          Faire l’inventaire
        </Link>
      )}
    </div>
  );
}
