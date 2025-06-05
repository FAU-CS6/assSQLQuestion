FROM srsolutions/ilias:latest

COPY . /var/www/html/Customizing/global/plugins/Modules/TestQuestionPool/Questions/assSQLQuestion/

RUN composer dump-autoload

# use ENTRYPOINT from FROM