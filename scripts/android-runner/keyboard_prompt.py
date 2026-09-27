"""Identify only the unrelated Gboard first-use contacts permission dialog."""
def gboard_contacts_denial(current):
    package = 'com.google.android.permissioncontroller'
    message = 'Allow Gboard to access contacts and accounts on this device?'
    if not any(n.get('package') == package and n.get('text') == message
               and n.get('resource-id') == 'com.android.permissioncontroller:id/permission_message'
               for n in current):
        return None
    choices = [n for n in current if n.get('package') == package
               and n.get('resource-id') == 'com.android.permissioncontroller:id/permission_deny_button'
               and n.get('enabled') == 'true' and n.get('clickable') == 'true']
    return choices[0] if len(choices) == 1 else None
