pipeline {
    environment {
        registryCredential = 'xe66gydo-gitlab'
    }

    agent any

    stages {
        stage('Build image') {
            steps {
                echo 'Starting to build docker image'

                script {
                    docker.withRegistry('https://cs6-gitlab.cs6.fau.de:4567/xe66gydo/asssqlquestion', registryCredential ) {
                        def customImage = docker.build("cs6-gitlab.cs6.fau.de:4567/xe66gydo/asssqlquestion:${env.BUILD_ID}")
                        customImage.push()
                        customImage.push('latest')
                    }
                }
            }
        }

        stage('Deploy image') {
            steps {
                sshagent(['jenkins']) {
                    sh '''
                    ssh -o StrictHostKeyChecking=no xe66gydo@ilias.cs6.fau.de docker compose -f /opt/containers/ilias/docker-compose.yml up -d --pull always
                    '''
                }
            }
        }

        stage('Build phpdocs') {
            agent {
                docker {
                    image 'phpdoc/phpdoc:3'
                    args '--entrypoint ""'
                }
            }
            steps {
                sh 'phpdoc run -t public'
                stash includes: 'public/**', name: 'docs'
            }
        }

        stage('Deploy phpdocs') {
            steps {
                sshagent(['jenkins']) {
                    unstash 'docs'
                    sh 'rsync -av --delete -e "ssh -o StrictHostKeyChecking=no" public/ xe66gydo@ilias.cs6.fau.de:/opt/containers/phpdocs/src'
                }
            }
        }
    }
}
