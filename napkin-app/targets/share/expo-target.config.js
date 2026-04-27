/** @type {import('@bacons/apple-targets').Config} */
module.exports = {
    type: 'share',
    name: 'Napkin',              // drives CFBundleDisplayName as a fallback
    icon: '../../assets/images/icon.png',
    deploymentTarget: '16.0',
    entitlements: {
        'com.apple.security.application-groups': ['group.com.majilaii.napkin.shared'],
    },
};
