FROM wordpress:latest

# Set up wordpress for "Static image / updates-via-redeploy"
WORKDIR /usr/src/wordpress
RUN set -eux
RUN find /etc/apache2 -name '*.conf' -type f -exec sed -ri -e "s!/var/www/html!$PWD!g" -e "s!Directory /var/www/!Directory $PWD!g" '{}' +
RUN cp -s wp-config-docker.php wp-config.php