FROM srsolutions/ilias:11

COPY . /var/www/html/public/Customizing/global/plugins/Modules/TestQuestionPool/Questions/assSQLQuestion/

RUN composer dump-autoload

# use ENTRYPOINT from FROM
