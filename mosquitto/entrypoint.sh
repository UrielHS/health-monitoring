#!/bin/sh
# Genera usuarios y permisos dentro del contenedor (no en la carpeta montada de Windows,
# donde los permisos salen abiertos y Mosquitto 2.1 se niega a leer el archivo).
set -e
mkdir -p /mosquitto/secure
rm -f /mosquitto/secure/passwd
mosquitto_passwd -b -c /mosquitto/secure/passwd "$MQTT_SERVER_USER" "$MQTT_SERVER_PASS"
mosquitto_passwd -b /mosquitto/secure/passwd "$MQTT_DEVICE_USER" "$MQTT_DEVICE_PASS"
mosquitto_passwd -b /mosquitto/secure/passwd "$MQTT_TEST_USER" "$MQTT_TEST_PASS"
cp /mosquitto/config/acl /mosquitto/secure/acl
chown -R mosquitto:mosquitto /mosquitto/secure /mosquitto/data
chmod 0700 /mosquitto/secure
chmod 0600 /mosquitto/secure/passwd /mosquitto/secure/acl
echo "[mosquitto] usuarios: $MQTT_SERVER_USER, $MQTT_DEVICE_USER, $MQTT_TEST_USER"
exec /usr/sbin/mosquitto -c /mosquitto/config/mosquitto.conf
